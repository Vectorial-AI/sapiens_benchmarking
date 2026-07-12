import fs from "fs";
import path from "path";
import type { EngineResult, PipelineMetrics, ReviewSentiment } from "./types";

export const PRE_RUN_COUNT = 3;

type BlindPrediction = {
  reviewText: string;
  predictedThemes?: Record<string, number>;
  sentiment?: ReviewSentiment | null;
};

type BlindRunDoc = {
  user_predictions?: Record<
    string,
    Array<{
      review_key?: string;
      prediction?: {
        review_text?: string;
        predicted_themes?: Record<string, number>;
        sentiment?: string;
      };
    }>
  >;
};

type DeltasDoc = {
  deltas?: Array<{
    review_key?: string;
    overall_similarity?: number;
    theme_delta_recall?: number;
    text_delta?: number;
    sentiment_match?: number;
  }>;
};

type CachedPreRun = {
  byReviewKey: Map<string, BlindPrediction>;
  metricsByReviewKey: Map<string, PipelineMetrics>;
};

const cache = new Map<string, CachedPreRun | null>();

function bundledPreRunDir(cluster: string, microId: string, preRunIndex: number): string {
  return path.join(
    process.cwd(),
    "src",
    "data",
    "pre_runs",
    cluster,
    microId,
    `pre_run_${preRunIndex}`,
  );
}

function workspacePreRunDir(cluster: string, microId: string, preRunIndex: number): string {
  return path.join(
    path.resolve(process.cwd(), ".."),
    "outputs",
    "amazon_sgo_health_care",
    cluster,
    microId,
    "pre_runs",
    `pre_run_${preRunIndex}`,
  );
}

function resolvePreRunDir(cluster: string, microId: string, preRunIndex: number): string {
  const bundled = bundledPreRunDir(cluster, microId, preRunIndex);
  const blindBundled = path.join(bundled, "blind_run_i2.json");
  if (fs.existsSync(blindBundled)) return bundled;
  return workspacePreRunDir(cluster, microId, preRunIndex);
}

function normalizeSentiment(value: unknown): ReviewSentiment | null {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "positive") return "Positive";
  if (s === "negative") return "Negative";
  if (s === "neutral") return "Neutral";
  return null;
}

function loadJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function indexBlindRun(doc: BlindRunDoc): Map<string, BlindPrediction> {
  const out = new Map<string, BlindPrediction>();
  const users = doc.user_predictions ?? {};
  for (const rows of Object.values(users)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const reviewKey = String(row.review_key ?? "").trim();
      const text = String(row.prediction?.review_text ?? "").trim();
      if (!reviewKey || !text) continue;
      out.set(reviewKey, {
        reviewText: text,
        predictedThemes: row.prediction?.predicted_themes,
        sentiment: normalizeSentiment(row.prediction?.sentiment),
      });
    }
  }
  return out;
}

function indexDeltas(doc: DeltasDoc): Map<string, PipelineMetrics> {
  const out = new Map<string, PipelineMetrics>();
  for (const row of doc.deltas ?? []) {
    const reviewKey = String(row.review_key ?? "").trim();
    if (!reviewKey) continue;
    const textDelta = row.text_delta;
    const recallMiss = row.theme_delta_recall;
    const overall = row.overall_similarity;
    const sentimentMatch = row.sentiment_match;
    out.set(reviewKey, {
      recallAtK: recallMiss == null ? null : Math.max(0, Math.min(1, 1 - Number(recallMiss))),
      textSimilarity:
        textDelta == null ? null : Math.max(0, Math.min(1, 1 - Number(textDelta))),
      textDelta: textDelta == null ? null : Number(textDelta),
      sentimentMatch: sentimentMatch == null ? null : Number(sentimentMatch),
      overallSimilarityScore: overall == null ? null : Number(overall),
      isMatch: overall == null ? null : Number(overall) >= 0.75,
    });
  }
  return out;
}

function loadPreRun(cluster: string, microId: string, preRunIndex: number): CachedPreRun | null {
  const key = `${cluster}/${microId}/pre_run_${preRunIndex}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  const dir = resolvePreRunDir(cluster, microId, preRunIndex);
  const blindPath = path.join(dir, "blind_run_i2.json");
  const deltasPath = path.join(dir, "i0_deltas_blind_run_i2.json");
  const blind = loadJson<BlindRunDoc>(blindPath);
  if (!blind) {
    cache.set(key, null);
    return null;
  }
  const deltas = loadJson<DeltasDoc>(deltasPath);
  const loaded: CachedPreRun = {
    byReviewKey: indexBlindRun(blind),
    metricsByReviewKey: deltas ? indexDeltas(deltas) : new Map(),
  };
  cache.set(key, loaded);
  return loaded;
}

export function hasPreRuns(cluster: string, microId: string): boolean {
  return loadPreRun(cluster, microId, 1) != null;
}

export function normalizePreRunIndex(value: unknown): number {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= PRE_RUN_COUNT) return n;
  return 1;
}

export function nextPreRunIndex(current: number): number {
  const n = normalizePreRunIndex(current);
  return n >= PRE_RUN_COUNT ? 1 : n + 1;
}

export type PrecomputedLookup = {
  preRunIndex: number;
  prediction: BlindPrediction;
  metrics: PipelineMetrics | null;
};

export function lookupPrecomputedPrediction(
  cluster: string,
  microId: string,
  reviewKey: string,
  preRunIndex: number,
): PrecomputedLookup | null {
  const idx = normalizePreRunIndex(preRunIndex);
  const loaded = loadPreRun(cluster, microId, idx);
  if (!loaded) return null;
  const prediction = loaded.byReviewKey.get(reviewKey);
  if (!prediction) return null;
  return {
    preRunIndex: idx,
    prediction,
    metrics: loaded.metricsByReviewKey.get(reviewKey) ?? null,
  };
}

export function toPrecomputedEngineResult(
  lookup: PrecomputedLookup,
  latencyMs: number,
): EngineResult {
  return {
    engine: "sapiens",
    reviewText: lookup.prediction.reviewText,
    predictedThemes: lookup.prediction.predictedThemes,
    sentiment: lookup.prediction.sentiment,
    metrics: lookup.metrics ?? undefined,
    model: `pre_run_${lookup.preRunIndex} (blind_i2)`,
    latencyMs,
  };
}

/** Fallback when bundled pre_runs are unavailable (e.g. before bundle deploy). */
export function catalogFallbackPrediction(
  product: {
    userHistoryReview?: string;
    userHistoryThemes?: string[];
    groundTruthSentiment?: ReviewSentiment | null;
    overallSimilarityScore?: number;
  },
  latencyMs: number,
): EngineResult | null {
  const reviewText = product.userHistoryReview?.trim();
  if (!reviewText) return null;
  const themes = product.userHistoryThemes ?? [];
  const predictedThemes =
    themes.length > 0 ? Object.fromEntries(themes.map((t) => [t, 1])) : undefined;
  const overall = product.overallSimilarityScore ?? null;
  return {
    engine: "sapiens",
    reviewText,
    predictedThemes,
    sentiment: product.groundTruthSentiment ?? null,
    metrics:
      overall == null
        ? undefined
        : {
            recallAtK: null,
            textSimilarity: null,
            textDelta: null,
            sentimentMatch: null,
            overallSimilarityScore: overall,
            isMatch: overall >= 0.75,
          },
    model: "catalog (blind_i2)",
    latencyMs,
  };
}
