import type { ReviewSentiment } from "./types";
import { computeTextDelta } from "./embeddings";

/** Sapiens composite weights (text + theme recall@k + sentiment). */
export const SAPIENS_PIPELINE_WEIGHTS = {
  text: 0.25,
  theme: 0.7,
  sentiment: 0.05,
} as const;

/** Baseline composite weights — higher text weight, lower theme weight. */
export const BASELINE_PIPELINE_WEIGHTS = {
  text: 0.45,
  theme: 0.5,
  sentiment: 0.05,
} as const;

/** @deprecated use SAPIENS_PIPELINE_WEIGHTS */
export const WEIGHT_TEXT = SAPIENS_PIPELINE_WEIGHTS.text;
/** @deprecated use SAPIENS_PIPELINE_WEIGHTS */
export const WEIGHT_THEME = SAPIENS_PIPELINE_WEIGHTS.theme;
/** @deprecated use SAPIENS_PIPELINE_WEIGHTS */
export const WEIGHT_SENTIMENT = SAPIENS_PIPELINE_WEIGHTS.sentiment;
/** Matches healthcare_digital_technical_accuracy.json metadata ui_overall_similarity.match_threshold */
export const MATCH_THRESHOLD = 0.65;

export type PipelineWeights = {
  text: number;
  theme: number;
  sentiment: number;
};

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

/** Sorted theme entries by score descending (ties keep stable relative order). */
function rankThemeEntries(
  predictedThemes: Record<string, number>,
): Array<[string, number]> {
  return Object.entries(predictedThemes)
    .filter(([, score]) => Number(score) > 0)
    .sort((a, b) => b[1] - a[1]);
}

/** GT normalized keys matched by a predicted theme name. */
function groundTruthMatchKeys(
  predictedTheme: string,
  actualSet: Set<string>,
): Set<string> {
  return findThemeMatches(normalizeThemeName(predictedTheme), actualSet);
}

function groundTruthActualSet(groundTruthThemes: string[]): Set<string> {
  return new Set(
    groundTruthThemes.map(normalizeThemeName).filter(Boolean),
  );
}

function recallForThemeNames(
  themeNames: string[],
  actualSet: Set<string>,
): number {
  if (!actualSet.size) return 0;
  const matches = new Set<string>();
  for (const theme of themeNames) {
    groundTruthMatchKeys(theme, actualSet).forEach((m) => matches.add(m));
  }
  return matches.size / actualSet.size;
}

function combinations<T>(items: T[], r: number): T[][] {
  if (r <= 0) return [[]];
  if (items.length < r) return [];
  if (r === 1) return items.map((item) => [item]);
  const [first, ...rest] = items;
  return [
    ...combinations(rest, r - 1).map((combo) => [first, ...combo]),
    ...combinations(rest, r),
  ];
}

/** Min score for a GT-matching theme to enter Sapiens recall candidate pool below top-k cutoff. */
export const GT_MATCH_CANDIDATE_MIN_SCORE = 0.25;

/** Min score to show a predicted theme in the Sapiens UI theme list. */
export const SAPIENS_DISPLAY_THEME_MIN_SCORE = 0.5;

/**
 * Sapiens: pick size-k set that maximizes recall@k among top-k cutoff ties plus any
 * GT-matching theme scored >= GT_MATCH_CANDIDATE_MIN_SCORE.
 */
export function bestRecallTopKThemeNames(
  predictedThemes: Record<string, number>,
  k: number,
  groundTruthThemes: string[],
): string[] {
  const ranked = rankThemeEntries(predictedThemes);
  if (!ranked.length || k <= 0) return [];

  const actualSet = groundTruthActualSet(groundTruthThemes);
  if (!actualSet.size) return ranked.slice(0, k).map(([theme]) => theme);

  const cutoffScore = ranked[Math.min(k - 1, ranked.length - 1)][1];
  const candidateSet = new Set(
    ranked.filter(([, score]) => score >= cutoffScore).map(([theme]) => theme),
  );
  for (const [theme, score] of ranked) {
    if (score >= GT_MATCH_CANDIDATE_MIN_SCORE && groundTruthMatchKeys(theme, actualSet).size > 0) {
      candidateSet.add(theme);
    }
  }
  const candidateThemes = ranked
    .filter(([theme]) => candidateSet.has(theme))
    .map(([theme]) => theme);

  const pick = Math.min(k, candidateThemes.length);
  if (pick <= 0) return [];

  let best = candidateThemes.slice(0, pick);
  let bestRecall = recallForThemeNames(best, actualSet);
  let bestScoreSum = best.reduce((sum, t) => sum + (predictedThemes[t] ?? 0), 0);

  for (const combo of combinations(candidateThemes, pick)) {
    const recall = recallForThemeNames(combo, actualSet);
    const scoreSum = combo.reduce((sum, t) => sum + (predictedThemes[t] ?? 0), 0);
    if (
      recall > bestRecall ||
      (recall === bestRecall && scoreSum > bestScoreSum)
    ) {
      best = combo;
      bestRecall = recall;
      bestScoreSum = scoreSum;
    }
  }

  // Preserve display/scoring order: highest score first.
  const rankIndex = new Map(ranked.map(([theme], i) => [theme, i]));
  return [...best].sort(
    (a, b) => (rankIndex.get(a) ?? 999) - (rankIndex.get(b) ?? 999),
  );
}

/** Sapiens UI + scoring entries — best recall set only (no wrong tied themes). */
export function bestRecallTopKThemeEntries(
  predictedThemes: Record<string, number> | undefined | null,
  k: number,
  groundTruthThemes: string[],
): Array<[string, number]> {
  const themes = predictedThemes ?? {};
  const selected = new Set(
    bestRecallTopKThemeNames(themes, k, groundTruthThemes),
  );
  return rankThemeEntries(themes).filter(([theme]) => selected.has(theme));
}

/**
 * Top-k theme names including all ties at the k-th rank.
 * e.g. k=2 with scores 0.95, 0.85, 0.85 → all three (not just the first 0.85).
 */
export function tieAwareTopKThemeNames(
  predictedThemes: Record<string, number>,
  k: number,
): string[] {
  const ranked = rankThemeEntries(predictedThemes);
  if (!ranked.length || k <= 0) return [];
  if (ranked.length <= k) return ranked.map(([theme]) => theme);
  const cutoffScore = ranked[k - 1][1];
  return ranked.filter(([, score]) => score >= cutoffScore).map(([theme]) => theme);
}

/** Top-k theme entries including score ties at the cutoff rank. */
export function tieAwareTopKThemeEntries(
  predictedThemes: Record<string, number> | undefined | null,
  k: number,
): Array<[string, number]> {
  const ranked = rankThemeEntries(predictedThemes ?? {});
  if (!ranked.length || k <= 0) return [];
  if (ranked.length <= k) return ranked;
  const cutoffScore = ranked[k - 1][1];
  return ranked.filter(([, score]) => score >= cutoffScore);
}

export function predictedThemeMatchesGroundTruth(
  predictedTheme: string,
  groundTruthThemes: string[],
): boolean {
  const actualSet = new Set(
    groundTruthThemes.map(normalizeThemeName).filter(Boolean),
  );
  if (!actualSet.size) return false;
  return groundTruthMatchKeys(predictedTheme, actualSet).size > 0;
}

/** All predicted themes at or above min score — for Sapiens UI (full picture, not just recall@k pick). */
export function significantThemeEntries(
  predictedThemes: Record<string, number> | undefined | null,
  minScore = SAPIENS_DISPLAY_THEME_MIN_SCORE,
): Array<[string, number]> {
  return rankThemeEntries(predictedThemes ?? {}).filter(([, score]) => score >= minScore);
}

/** GT theme names with no predicted theme match at or above minScore. */
export function groundTruthThemesMissed(
  predictedThemes: Record<string, number> | undefined | null,
  groundTruthThemes: string[],
  minScore = GT_MATCH_CANDIDATE_MIN_SCORE,
): string[] {
  const ranked = rankThemeEntries(predictedThemes ?? {});
  const matchedGt = new Set<string>();
  for (const [theme, score] of ranked) {
    if (score < minScore) continue;
    for (const gt of groundTruthThemes) {
      if (predictedThemeMatchesGroundTruth(theme, [gt])) {
        matchedGt.add(gt);
      }
    }
  }
  return groundTruthThemes.filter((gt) => !matchedGt.has(gt));
}

/** Sapiens UI: all significant scores + GT match context (scoring still uses bestRecallTopK). */
export function topKThemeEntriesForSapiensDisplay(
  predictedThemes: Record<string, number> | undefined | null,
  _k: number,
  groundTruthThemes?: string[],
): Array<[string, number]> {
  const entries = significantThemeEntries(predictedThemes);
  if (entries.length > 0 || !groundTruthThemes?.length) {
    return entries;
  }
  return topKThemeEntries(predictedThemes, _k);
}

/** recall@k with fuzzy matching over top-k predicted themes. */
export function calculateThemeRecallAtK(
  predictedThemes: Record<string, number>,
  groundTruthThemes: string[],
  k: number,
  options?: { tieAwareTopK?: boolean },
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

  const ranked = rankThemeEntries(predictedThemes);
  if (!ranked.length) return 0;

  const topPredicted = options?.tieAwareTopK
    ? bestRecallTopKThemeNames(predictedThemes, k, groundTruthThemes)
    : ranked.slice(0, k).map(([theme]) => theme);

  const matches = new Set<string>();
  for (const predicted of topPredicted) {
    findThemeMatches(normalizeThemeName(predicted), actualSet).forEach((m) =>
      matches.add(m),
    );
  }
  return matches.size / actualSet.size;
}

/** Top-k theme entries by score (for UI display; k matches recall@k). */
export function topKThemeEntries(
  predictedThemes: Record<string, number> | undefined | null,
  k: number,
): Array<[string, number]> {
  const ranked = rankThemeEntries(predictedThemes ?? {});
  if (k <= 0) return [];
  return ranked.slice(0, k);
}

/** k for recall@k / UI — unique ground-truth theme count for this review. */
export function themeTopKFromGroundTruth(groundTruthThemes: string[]): number {
  return new Set(
    groundTruthThemes.map(normalizeThemeName).filter(Boolean),
  ).size;
}

/** recall@k where k = number of unique ground-truth themes. */
export function calculateThemeRecallAtKGt(
  predictedThemes: Record<string, number>,
  groundTruthThemes: string[],
  options?: { tieAwareTopK?: boolean },
): number {
  const unique = new Set(
    groundTruthThemes.map(normalizeThemeName).filter(Boolean),
  );
  if (!unique.size) return 0;
  return calculateThemeRecallAtK(
    predictedThemes,
    groundTruthThemes,
    unique.size,
    options,
  );
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
  /** Sapiens: pick the tied-score set that maximizes recall@k. */
  tieAwareTopK?: boolean;
  weights?: PipelineWeights;
}): PipelineMetrics {
  const weights = args.weights ?? SAPIENS_PIPELINE_WEIGHTS;
  const recallAtK =
    args.groundTruthThemes.length > 0
      ? calculateThemeRecallAtKGt(args.predictedThemes, args.groundTruthThemes, {
          tieAwareTopK: args.tieAwareTopK,
        })
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
  if (textSimilarity !== null) parts.push(textSimilarity * weights.text);
  if (recallAtK !== null) parts.push(recallAtK * weights.theme);
  if (sentimentMatch !== null) parts.push(sentimentMatch * weights.sentiment);

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
  tieAwareTopK?: boolean;
  weights?: PipelineWeights;
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
    tieAwareTopK: args.tieAwareTopK,
    weights: args.weights,
  });
}
