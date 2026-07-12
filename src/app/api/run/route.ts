import { NextResponse } from "next/server";
import { findContext, type Tribe, type User } from "@/lib/master";
import {
  BASELINE_METHODS,
  BASELINE_MODELS,
  SAPIENS_MODEL,
  toGatewayModel,
  type BaselineMethod,
  type BaselineModel,
} from "@/lib/baselines";
import {
  buildBaselinePrompt,
  buildSapiensPrompt,
  buildUserHistoryContext,
  parsePredictionResponse,
  REVIEW_SYSTEM,
} from "@/lib/prompts";
import { hasGatewayKey, mockPrediction, runModel } from "@/lib/ai";
import { generateInferredTraitInfluences } from "@/lib/inferred-traits-explanation";
import { generateSimilarityExplanation, buildSimilarityFallbackExplanation } from "@/lib/similarity-explanation";
import {
  lookupPrecomputedPrediction,
  normalizePreRunIndex,
  catalogFallbackPrediction,
  toPrecomputedEngineResult,
} from "@/lib/precomputed-predictions";
import {
  BASELINE_PIPELINE_WEIGHTS,
  scorePredictionAgainstGroundTruth,
  themeTopKFromGroundTruth,
} from "@/lib/scoring";
import type { EngineResult, ReviewSentiment, RunMode } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type ScoringGroundTruth = {
  reviewText: string;
  themes: string[];
  sentiment: ReviewSentiment | null;
} | null;

async function attachMetrics(
  result: EngineResult,
  groundTruth: NonNullable<ScoringGroundTruth>,
  label?: string,
): Promise<EngineResult> {
  if (!result.reviewText.trim() || result.error) return result;
  const metrics = await scorePredictionAgainstGroundTruth({
    reviewText: result.reviewText,
    predictedThemes: result.predictedThemes,
    sentiment: result.sentiment,
    groundTruth,
    tieAwareTopK: result.engine === "sapiens",
    weights: result.engine === "baseline" ? BASELINE_PIPELINE_WEIGHTS : undefined,
  });
  const similarityExplanation = await generateSimilarityExplanation({
    generatedReview: result.reviewText,
    groundTruthReview: groundTruth.reviewText,
    groundTruthThemes: groundTruth.themes,
    predictedThemes: result.predictedThemes,
    predictedSentiment: result.sentiment,
    groundTruthSentiment: groundTruth.sentiment,
    metrics,
    label,
    engine: result.engine,
  });
  return { ...result, metrics, similarityExplanation };
}

async function runEngine(
  engine: "baseline" | "sapiens",
  prompt: string,
  model: string,
  temperature = 0.8,
): Promise<EngineResult> {
  const start = Date.now();
  try {
    const raw = await runModel({
      model,
      system: REVIEW_SYSTEM,
      prompt,
      temperature,
    });
    const parsed = parsePredictionResponse(raw);
    return {
      engine,
      reviewText: parsed.reviewText,
      predictedThemes: parsed.predictedThemes,
      sentiment: parsed.sentiment,
      model,
      latencyMs: Date.now() - start,
    };
  } catch (e) {
    return {
      engine,
      reviewText: "",
      model,
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : "generation failed",
    };
  }
}

function formatUserHistoryVariable(items: ReturnType<typeof buildUserHistoryContext>): string {
  if (!items.length) return "(no user history available)";
  return items
    .map((item, index) => `Example ${index + 1}:\n${item.reviewText}\n`)
    .join("\n");
}

export async function POST(req: Request) {
  const body = await req.json();
  const {
    tribeId,
    userId,
    reviewKey,
    productDescription: customDesc,
    category: customCategory,
    populationDefinition: customPopulationDefinition,
    tribeDefinition: customTribeDefinition,
    customBaselinePrompt,
    runMode = "sapiens",
    baselineMethod,
    baselineModel,
    preRunIndex,
  } = body as {
    tribeId: string;
    userId: string;
    reviewKey?: string;
    productDescription?: string;
    category?: string;
    populationDefinition?: string;
    tribeDefinition?: string;
    customBaselinePrompt?: string;
    runMode?: RunMode;
    baselineMethod?: BaselineMethod;
    baselineModel?: BaselineModel;
    preRunIndex?: number;
  };

  const mode: RunMode = runMode ?? "sapiens";

  if (mode === "baseline") {
    if (!baselineMethod || !BASELINE_METHODS.includes(baselineMethod)) {
      return NextResponse.json({ error: "Invalid baseline method" }, { status: 400 });
    }
    if (!baselineModel || !BASELINE_MODELS.includes(baselineModel)) {
      return NextResponse.json({ error: "Invalid baseline model" }, { status: 400 });
    }
  }

  const context = findContext(tribeId, userId, reviewKey);
  if (!context.tribe || !context.user) {
    return NextResponse.json({ error: "Unknown tribe or user" }, { status: 400 });
  }
  const tribe: Tribe = context.tribe;
  const user: User = context.user;
  const product = context.product ?? null;

  const productDescription = (
    customDesc?.trim() ||
    product?.productDescription ||
    ""
  ).trim();
  if (!productDescription) {
    return NextResponse.json(
      { error: "A product description is required" },
      { status: 400 },
    );
  }
  const category = customCategory || product?.category || "Health & Personal Care";
  const groundTruth = product?.groundTruthReview ?? null;
  const groundTruthThemes = product?.predictedThemes ?? [];
  const groundTruthSentiment = product?.groundTruthSentiment ?? null;
  const themeTopK = themeTopKFromGroundTruth(groundTruthThemes);

  const scoringGroundTruth: ScoringGroundTruth =
    groundTruth && groundTruth.trim()
      ? { reviewText: groundTruth, themes: groundTruthThemes, sentiment: groundTruthSentiment }
      : null;

  const metricsSource = hasGatewayKey() ? "pipeline" : "mock";

  const promptBase = {
    tribe,
    user,
    product,
    productDescription,
    category,
    excludeReviewKey: reviewKey,
    groundTruthThemes,
  };

  // ---- SAPIENS ----
  if (mode === "sapiens") {
    let sapiens: EngineResult | null = null;
    let source: string = hasGatewayKey() ? "gateway" : "mock";
    let usedPrecomputed = false;
    let resolvedPreRunIndex: number | null = null;

    // Video-games tribes with blind i2 pre_runs: serve rotating precomputed reviews
    // (no live review generation). Baselines stay live.
    const requestedPreRun = normalizePreRunIndex(preRunIndex);
    const canUsePrecomputed = Boolean(reviewKey) && tribe.domain === "video_games";

    if (canUsePrecomputed && reviewKey) {
      const showcaseLatencyMs = 2000;
      const lookup = lookupPrecomputedPrediction(
        tribe.cluster,
        tribe.microId,
        reviewKey,
        requestedPreRun,
      );
      if (lookup) {
        usedPrecomputed = true;
        resolvedPreRunIndex = lookup.preRunIndex;
        await new Promise((r) => setTimeout(r, showcaseLatencyMs));
        sapiens = toPrecomputedEngineResult(lookup, showcaseLatencyMs);
        source = `pre_run_${lookup.preRunIndex}`;
      } else if (product?.userHistoryReview?.trim()) {
        usedPrecomputed = true;
        await new Promise((r) => setTimeout(r, showcaseLatencyMs));
        sapiens = catalogFallbackPrediction(product, showcaseLatencyMs);
        source = "catalog";
      }
    }

    if (!sapiens) {
      const sapiensPrompt = buildSapiensPrompt({
        ...promptBase,
        groundTruthSentiment,
      });

      if (!hasGatewayKey()) {
        const mock = mockPrediction("sapiens", productDescription);
        sapiens = {
          engine: "sapiens",
          reviewText: mock.reviewText,
          predictedThemes: mock.predictedThemes,
          sentiment: mock.sentiment,
          model: `${SAPIENS_MODEL} (mock)`,
          latencyMs: 0,
        };
      } else {
        const sapiensTemperature = tribe.domain === "healthcare" ? 0.2 : 0.8;
        sapiens = await runEngine("sapiens", sapiensPrompt, SAPIENS_MODEL, sapiensTemperature);
      }
    }

    const inferredTraits =
      sapiens.reviewText.trim() && !usedPrecomputed
        ? await generateInferredTraitInfluences({
            sapiensReview: sapiens.reviewText,
            tribe,
            user,
            category,
          })
        : null;

    // Prefer precomputed delta metrics; otherwise score live.
    if (!sapiens.metrics && scoringGroundTruth) {
      sapiens = await attachMetrics(sapiens, scoringGroundTruth, "SAPIENS");
    } else if (sapiens.metrics && scoringGroundTruth) {
      const similarityExplanation = usedPrecomputed
        ? buildSimilarityFallbackExplanation({
            generatedReview: sapiens.reviewText,
            groundTruthReview: scoringGroundTruth.reviewText,
            groundTruthThemes: scoringGroundTruth.themes,
            metrics: sapiens.metrics,
            engine: "sapiens",
          })
        : await generateSimilarityExplanation({
            generatedReview: sapiens.reviewText,
            groundTruthReview: scoringGroundTruth.reviewText,
            groundTruthThemes: scoringGroundTruth.themes,
            predictedThemes: sapiens.predictedThemes,
            predictedSentiment: sapiens.sentiment,
            groundTruthSentiment: scoringGroundTruth.sentiment,
            metrics: sapiens.metrics,
            label: "SAPIENS",
            engine: "sapiens",
          });
      sapiens = { ...sapiens, similarityExplanation };
    }

    sapiens = {
      ...sapiens,
      inferredTraitSummary: inferredTraits?.summary ?? null,
      inferredTraitInfluences: inferredTraits?.influences ?? null,
    };

    return NextResponse.json({
      groundTruth,
      groundTruthThemes,
      groundTruthSentiment,
      themeTopK,
      sapiens,
      source,
      metricsSource: usedPrecomputed ? "pipeline" : metricsSource,
      preRunIndex: resolvedPreRunIndex,
    });
  }

  // ---- BASELINE ----
  const method = baselineMethod as BaselineMethod;
  const bModel = baselineModel as BaselineModel;
  const gateway = toGatewayModel(bModel);
  const usingCustomPopulationDef =
    method === "population_persona" && Boolean(customPopulationDefinition?.trim());
  const usingCustomTribeDef =
    method === "tribe_persona" && Boolean(customTribeDefinition?.trim());
  const key = usingCustomPopulationDef
    ? `${method}:${bModel}:custom`
    : usingCustomTribeDef
      ? `${method}:${bModel}:custom-tribe`
      : `${method}:${bModel}`;

  const historyContext =
    method === "history"
      ? buildUserHistoryContext(user, {
          excludeReviewKey: reviewKey,
          excludeReviewText: product?.groundTruthReview,
          product,
        })
      : undefined;

  let baseline: EngineResult;
  const defaultBaselinePrompt = buildBaselinePrompt(method, {
      ...promptBase,
      populationDefinition: usingCustomPopulationDef
        ? customPopulationDefinition
        : undefined,
      tribeDefinition: usingCustomTribeDef ? customTribeDefinition : undefined,
    });
  const baselinePrompt = (customBaselinePrompt?.trim() || defaultBaselinePrompt).replace(
    /\{user_history\}/g,
    formatUserHistoryVariable(historyContext ?? []),
  );

  if (!hasGatewayKey()) {
    const mock = mockPrediction("baseline", productDescription, method);
    baseline = {
      engine: "baseline",
      reviewText: mock.reviewText,
      predictedThemes: mock.predictedThemes,
      sentiment: mock.sentiment,
      model: `${gateway} (mock)`,
      latencyMs: 0,
    };
  } else {
    baseline = await runEngine("baseline", baselinePrompt, gateway);
  }

  if (scoringGroundTruth) {
    baseline = await attachMetrics(
      baseline,
      scoringGroundTruth,
      `${method} baseline`,
    );
  }

  return NextResponse.json({
    baseline: {
      ...baseline,
      key,
      method,
      baselineModel: bModel,
      historyContext,
      baselinePrompt,
    },
    themeTopK,
    source: hasGatewayKey() ? "gateway" : "mock",
    metricsSource,
  });
}
