import { NextResponse } from "next/server";
import { findContext } from "@/lib/master";
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
  wordCount,
  REVIEW_SYSTEM,
} from "@/lib/prompts";
import { hasGatewayKey, mockPrediction, runModel } from "@/lib/ai";
import { scorePredictionAgainstGroundTruth } from "@/lib/scoring";
import type { EngineResult, ReviewSentiment } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

async function attachMetrics(
  result: EngineResult,
  groundTruth: {
    reviewText: string;
    themes: string[];
    sentiment: ReviewSentiment | null;
  },
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

export async function POST(req: Request) {
  const body = await req.json();
  const {
    tribeId,
    userId,
    reviewKey,
    productDescription: customDesc,
    category: customCategory,
    baselineMethod,
    baselineModel,
  } = body as {
    tribeId: string;
    userId: string;
    reviewKey?: string;
    productDescription?: string;
    category?: string;
    baselineMethod: BaselineMethod;
    baselineModel: BaselineModel;
  };

  if (!BASELINE_METHODS.includes(baselineMethod)) {
    return NextResponse.json({ error: "Invalid baseline method" }, { status: 400 });
  }
  if (!BASELINE_MODELS.includes(baselineModel)) {
    return NextResponse.json({ error: "Invalid baseline model" }, { status: 400 });
  }

  const { tribe, user, product: found } = findContext(tribeId, userId, reviewKey);
  if (!tribe || !user) {
    return NextResponse.json({ error: "Unknown tribe or user" }, { status: 400 });
  }
  const product = found ?? null;

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
  const lengthConstraint = groundTruth
    ? Math.max(120, wordCount(groundTruth))
    : 250;

  const scoringGroundTruth =
    groundTruth && groundTruth.trim()
      ? {
          reviewText: groundTruth,
          themes: groundTruthThemes,
          sentiment: groundTruthSentiment,
        }
      : null;

  const baselinePrompt = buildBaselinePrompt(baselineMethod, {
    tribe,
    user,
    product,
    productDescription,
    category,
    excludeReviewKey: reviewKey,
  });
  const sapiensPrompt = buildSapiensPrompt({
    tribe,
    user,
    product,
    productDescription,
    category,
    lengthConstraint,
  });

  const historyContext =
    baselineMethod === "history"
      ? buildHistoryContext({ user, excludeReviewKey: reviewKey })
      : undefined;

  const baselineGateway = toGatewayModel(baselineModel);
  const sapiensGateway = SAPIENS_MODEL;
  const metricsSource = hasGatewayKey() ? "pipeline" : "mock";

  if (!hasGatewayKey()) {
    const baselineMock = mockPrediction("baseline", productDescription, baselineMethod);
    const sapiensMock = mockPrediction("sapiens", productDescription);
    let baseline: EngineResult = {
      engine: "baseline",
      reviewText: baselineMock.reviewText,
      predictedThemes: baselineMock.predictedThemes,
      sentiment: baselineMock.sentiment,
      model: `${baselineGateway} (mock)`,
      latencyMs: 0,
    };
    let sapiens: EngineResult = {
      engine: "sapiens",
      reviewText: sapiensMock.reviewText,
      predictedThemes: sapiensMock.predictedThemes,
      sentiment: sapiensMock.sentiment,
      model: `${sapiensGateway} (mock)`,
      latencyMs: 0,
    };

    if (scoringGroundTruth) {
      [baseline, sapiens] = await Promise.all([
        attachMetrics(baseline, scoringGroundTruth),
        attachMetrics(sapiens, scoringGroundTruth),
      ]);
    }

    return NextResponse.json({
      groundTruth,
      groundTruthThemes,
      groundTruthSentiment,
      baselineMethod,
      baselineModel,
      results: { baseline, sapiens },
      historyContext,
      source: "mock",
      metricsSource,
    });
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

  let [baseline, sapiens] = await Promise.all([
    runEngine("baseline", baselinePrompt, baselineGateway),
    runEngine("sapiens", sapiensPrompt, sapiensGateway),
  ]);

  if (scoringGroundTruth) {
    [baseline, sapiens] = await Promise.all([
      attachMetrics(baseline, scoringGroundTruth),
      attachMetrics(sapiens, scoringGroundTruth),
    ]);
  }

  return NextResponse.json({
    groundTruth,
    groundTruthThemes,
    groundTruthSentiment,
    baselineMethod,
    baselineModel,
    results: { baseline, sapiens },
    historyContext,
    source: "gateway",
    metricsSource,
  });
}
