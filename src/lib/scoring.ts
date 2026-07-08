import type { ReviewSentiment } from "./types";
import { computeTextDelta } from "./embeddings";

/** Matches Clustering/baseline_mode_names.py defaults. */
export const WEIGHT_TEXT = 0.25;
export const WEIGHT_THEME = 0.7;
export const WEIGHT_SENTIMENT = 0.05;
export const MATCH_THRESHOLD = 0.75;

export type PipelineMetrics = {
  recallAtK: number | null;
  textSimilarity: number | null;
  textDelta: number | null;
  sentimentMatch: number | null;
  overallSimilarityScore: number | null;
  isMatch: boolean | null;
};

export type GroundTruthForScoring = {
  reviewText: string;
  themes: string[];
  sentiment: ReviewSentiment | null;
};

const STOP_WORDS = new Set([
  "and",
  "or",
  "the",
  "a",
  "an",
  "of",
  "for",
  "in",
  "on",
  "at",
  "to",
  "with",
]);

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export function normalizeThemeName(theme: string): string {
  return theme.trim().toLowerCase();
}

function themeWords(theme: string): Set<string> {
  return new Set(
    theme
      .replace(/,/g, " ")
      .replace(/&/g, " ")
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w && !STOP_WORDS.has(w)),
  );
}

/** Fuzzy theme-name matching — port of prediction_history_metrics.find_theme_matches */
function findThemeMatches(
  predictedNormalized: string,
  actualNormalized: Set<string>,
): Set<string> {
  const matches = new Set<string>();
  for (const actualNorm of actualNormalized) {
    if (predictedNormalized === actualNorm) {
      matches.add(actualNorm);
      continue;
    }
    if (
      predictedNormalized.includes(actualNorm) ||
      actualNorm.includes(predictedNormalized)
    ) {
      matches.add(actualNorm);
      continue;
    }
    const predWords = themeWords(predictedNormalized);
    const actualWords = themeWords(actualNorm);
    if (predWords.size && actualWords.size) {
      let overlap = 0;
      predWords.forEach((w) => {
        if (actualWords.has(w)) overlap++;
      });
      const minOverlap = Math.max(
        2,
        Math.min(predWords.size, actualWords.size) * 0.5,
      );
      if (overlap >= minOverlap) matches.add(actualNorm);
    }
  }
  return matches;
}

/** recall@k with fuzzy matching over top-k predicted themes. */
export function calculateThemeRecallAtK(
  predictedThemes: Record<string, number>,
  groundTruthThemes: string[],
  k: number,
): number {
  const gtNames = groundTruthThemes.map((t) => t.trim()).filter(Boolean);
  if (!gtNames.length || k <= 0) return 0;

  const actualNormalized = new Map<string, string>();
  for (const name of gtNames) {
    const norm = normalizeThemeName(name);
    if (norm) actualNormalized.set(norm, name);
  }
  const actualSet = new Set(actualNormalized.keys());
  if (!actualSet.size) return 0;

  const ranked = Object.entries(predictedThemes)
    .filter(([, score]) => Number(score) > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return 0;

  const topPredicted = ranked.slice(0, k).map(([theme]) => theme);
  const matches = new Set<string>();
  for (const predicted of topPredicted) {
    findThemeMatches(normalizeThemeName(predicted), actualSet).forEach((m) =>
      matches.add(m),
    );
  }
  return matches.size / actualSet.size;
}

/** recall@k where k = number of unique ground-truth themes. */
export function calculateThemeRecallAtKGt(
  predictedThemes: Record<string, number>,
  groundTruthThemes: string[],
): number {
  const unique = new Set(
    groundTruthThemes.map(normalizeThemeName).filter(Boolean),
  );
  if (!unique.size) return 0;
  return calculateThemeRecallAtK(predictedThemes, groundTruthThemes, unique.size);
}

export function normalizeSentimentLabel(
  value: string | null | undefined,
): ReviewSentiment | null {
  if (!value) return null;
  const s = value.trim().toLowerCase();
  if (s === "positive") return "Positive";
  if (s === "negative") return "Negative";
  if (s === "neutral") return "Neutral";
  return null;
}

function sentimentMatchScore(
  predicted: ReviewSentiment | null | undefined,
  groundTruth: ReviewSentiment | null | undefined,
): number | null {
  if (!predicted || !groundTruth) return null;
  return predicted === groundTruth ? 1 : 0;
}

/**
 * Composite similarity — port of build_sapiens_vs_baselines_dataset.mode_scores().
 * Higher = closer to ground truth.
 */
export function computePipelineMetrics(args: {
  predictedThemes: Record<string, number>;
  groundTruthThemes: string[];
  textDelta: number | null;
  predictedSentiment?: ReviewSentiment | null;
  groundTruthSentiment?: ReviewSentiment | null;
}): PipelineMetrics {
  const recallAtK =
    args.groundTruthThemes.length > 0
      ? calculateThemeRecallAtKGt(args.predictedThemes, args.groundTruthThemes)
      : null;

  let textSimilarity: number | null = null;
  if (args.textDelta !== null && !Number.isNaN(args.textDelta)) {
    textSimilarity = Math.max(0, 1 - args.textDelta);
  }

  const sentimentMatch = sentimentMatchScore(
    args.predictedSentiment,
    args.groundTruthSentiment,
  );

  const parts: number[] = [];
  if (textSimilarity !== null) parts.push(textSimilarity * WEIGHT_TEXT);
  if (recallAtK !== null) parts.push(recallAtK * WEIGHT_THEME);
  if (sentimentMatch !== null) parts.push(sentimentMatch * WEIGHT_SENTIMENT);

  const overall =
    parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null;

  return {
    recallAtK: recallAtK !== null ? round4(recallAtK) : null,
    textSimilarity: textSimilarity !== null ? round4(textSimilarity) : null,
    textDelta:
      args.textDelta !== null && !Number.isNaN(args.textDelta)
        ? round4(args.textDelta)
        : null,
    sentimentMatch: sentimentMatch !== null ? round4(sentimentMatch) : null,
    overallSimilarityScore: overall !== null ? round4(overall) : null,
    isMatch: overall !== null ? overall >= MATCH_THRESHOLD : null,
  };
}

export async function scorePredictionAgainstGroundTruth(args: {
  reviewText: string;
  predictedThemes?: Record<string, number>;
  sentiment?: ReviewSentiment | null;
  groundTruth: GroundTruthForScoring;
}): Promise<PipelineMetrics> {
  const textDelta = args.reviewText.trim()
    ? await computeTextDelta(args.reviewText, args.groundTruth.reviewText)
    : null;

  return computePipelineMetrics({
    predictedThemes: args.predictedThemes ?? {},
    groundTruthThemes: args.groundTruth.themes,
    textDelta,
    predictedSentiment: args.sentiment,
    groundTruthSentiment: args.groundTruth.sentiment,
  });
}
