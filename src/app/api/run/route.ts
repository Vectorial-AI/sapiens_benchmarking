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
  buildHistoryContext,
  buildSapiensPrompt,
  parsePredictionResponse,
  REVIEW_SYSTEM,
} from "@/lib/prompts";
import {
  buildSapiensHistoryContext,
  excludeTargetReviewText,
  formatLengthConstraint,
} from "@/lib/review-history";
import { hasGatewayKey, mockPrediction, runModel } from "@/lib/ai";
import {
  logBaselinePromptFull,
  logFullPrompt,
  logSapiensPromptContext,
} from "@/lib/prompt-log";
import { scorePredictionAgainstGroundTruth } from "@/lib/scoring";
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
): Promise<EngineResult> {
  if (!result.reviewText.trim() || result.error) return result;
  const metrics = await scorePredictionAgainstGroundTruth({
    reviewText: result.reviewText,
    predictedThemes: result.predictedThemes,
    sentiment: result.sentiment,
    groundTruth,
  });
  return { ...result, metrics };
}

async function runEngine(
  engine: "baseline" | "sapiens",
  prompt: string,
  model: string,
): Promise<EngineResult> {
  const start = Date.now();
  try {
    const raw = await runModel({
      model,
      system: REVIEW_SYSTEM,
      prompt,
      temperature: 0.8,
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

export async function POST(req: Request) {
  const body = await req.json();
  const {
    tribeId,
    userId,
    reviewKey,
    productDescription: customDesc,
    category: customCategory,
    populationDefinition: customPopulationDefinition,
    runMode = "sapiens",
    baselineMethod,
    baselineModel,
  } = body as {
    tribeId: string;
    userId: string;
    reviewKey?: string;
    productDescription?: string;
    category?: string;
    populationDefinition?: string;
    runMode?: RunMode;
    baselineMethod?: BaselineMethod;
    baselineModel?: BaselineModel;
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
  const lengthConstraint =
    formatLengthConstraint(groundTruth ?? "") ?? 250;

  const scoringGroundTruth: ScoringGroundTruth =
    groundTruth && groundTruth.trim()
      ? { reviewText: groundTruth, themes: groundTruthThemes, sentiment: groundTruthSentiment }
      : null;

  const metricsSource = hasGatewayKey() ? "pipeline" : "mock";

  const sapiensHistoryContext = excludeTargetReviewText(
    buildSapiensHistoryContext({
      products: user.products,
      excludeReviewKey: reviewKey,
      targetCategory: category,
    }),
    product?.groundTruthReview,
  );
  const hasBestPredictionReference = Boolean(product?.bestPredictionReview?.trim());

  const promptBase = {
    tribe,
    user,
    product,
    productDescription,
    category,
    excludeReviewKey: reviewKey,
  };

  function logAllPrompts(sapiensPrompt: string, runModeLabel: "sapiens" | "mock") {
    logFullPrompt("system", REVIEW_SYSTEM, {
      tribeId,
      userId,
      reviewKey: reviewKey ?? null,
      note: "System message sent with every engine call",
    });
    logSapiensPromptContext({
      tribeId,
      userId,
      reviewKey,
      category,
      tribe,
      user,
      product,
      historyItems: sapiensHistoryContext,
      hasBestPredictionReference,
      promptCharLength: sapiensPrompt.length,
      mode: runModeLabel,
    });
    logFullPrompt("sapiens", sapiensPrompt, {
      tribeId,
      userId,
      reviewKey: reviewKey ?? null,
      model: SAPIENS_MODEL,
    });
    for (const method of BASELINE_METHODS) {
      const baselinePrompt = buildBaselinePrompt(method, {
        ...promptBase,
        populationDefinition:
          method === "population_persona" ? tribe.populationDefinition : undefined,
      });
      logBaselinePromptFull({
        method,
        tribeId,
        userId,
        reviewKey,
        prompt: baselinePrompt,
      });
    }
  }

  // ---- SAPIENS ----
  if (mode === "sapiens") {
    let sapiens: EngineResult;
    const runModeLabel = hasGatewayKey() ? "sapiens" : "mock";

    const sapiensPrompt = buildSapiensPrompt({
      ...promptBase,
      lengthConstraint,
    });
    logAllPrompts(sapiensPrompt, runModeLabel);

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
      sapiens = await runEngine("sapiens", sapiensPrompt, SAPIENS_MODEL);
    }

    if (scoringGroundTruth) sapiens = await attachMetrics(sapiens, scoringGroundTruth);

    return NextResponse.json({
      groundTruth,
      groundTruthThemes,
      groundTruthSentiment,
      sapiens,
      source: hasGatewayKey() ? "gateway" : "mock",
      metricsSource,
    });
  }

  // ---- BASELINE ----
  const method = baselineMethod as BaselineMethod;
  const bModel = baselineModel as BaselineModel;
  const gateway = toGatewayModel(bModel);
  const usingCustomPopulationDef =
    method === "population_persona" && Boolean(customPopulationDefinition?.trim());
  const key = usingCustomPopulationDef
    ? `${method}:${bModel}:custom`
    : `${method}:${bModel}`;

  const historyContext =
    method === "history"
      ? buildHistoryContext({
          user,
          excludeReviewKey: reviewKey,
          excludeReviewText: product?.groundTruthReview,
        })
      : undefined;

  let baseline: EngineResult;
  const baselinePrompt = buildBaselinePrompt(method, {
    ...promptBase,
    populationDefinition: usingCustomPopulationDef
      ? customPopulationDefinition
      : undefined,
  });
  logFullPrompt("system", REVIEW_SYSTEM, {
    tribeId,
    userId,
    reviewKey: reviewKey ?? null,
    note: "System message sent with every engine call",
  });
  logBaselinePromptFull({
    method,
    tribeId,
    userId,
    reviewKey,
    prompt: baselinePrompt,
    model: gateway,
  });

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

  if (scoringGroundTruth) baseline = await attachMetrics(baseline, scoringGroundTruth);

  return NextResponse.json({
    baseline: {
      ...baseline,
      key,
      method,
      baselineModel: bModel,
      historyContext,
    },
    source: hasGatewayKey() ? "gateway" : "mock",
    metricsSource,
  });
}
