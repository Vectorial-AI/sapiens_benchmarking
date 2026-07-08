import { hasGatewayKey, runModel } from "./ai";
import { MATCH_THRESHOLD, topKThemeEntries } from "./scoring";
import type { PipelineMetrics, ReviewSentiment } from "./types";

export const SIMILARITY_EXPLAINER_MODEL = "openai/gpt-4o-mini";

type ExplanationEngine = "sapiens" | "baseline";

type ScoreBucket = "high" | "mid" | "low" | "very_low";

function themeList(themes: string[] | undefined): string {
  if (!themes?.length) return "(none listed)";
  return themes.join(", ");
}

function predictedThemeList(
  predicted: Record<string, number> | undefined,
  k: number,
): string {
  if (!predicted) return "(none)";
  const entries = topKThemeEntries(predicted, k);
  if (!entries.length) return "(none)";
  return entries.map(([t]) => t).join(", ");
}

function scoreBucket(score: number, engine: ExplanationEngine): ScoreBucket {
  if (score >= 0.75) return "high";
  if (score >= MATCH_THRESHOLD) return "mid";
  if (engine === "baseline" && score < 0.4) return "very_low";
  if (score < 0.45) return "very_low";
  return "low";
}

function openingGuide(bucket: ScoreBucket, engine: ExplanationEngine): string {
  if (engine === "baseline") {
    switch (bucket) {
      case "high":
        return 'Start with "Close to the real review" — what specific points match.';
      case "mid":
        return 'Start with "Some overlap" — one shared point, then what the baseline misses.';
      case "low":
        return 'Start with "Different from the real review" — lead with what the baseline emphasizes instead.';
      case "very_low":
        return 'Start with "Mostly misses the real review" — stress how different it is; do NOT say similar, partly similar, or overlap.';
    }
  }

  switch (bucket) {
    case "high":
      return 'Start with "Close to the real review" — what specific points both mention.';
    case "mid":
      return 'Start with "Close to the real review" — only name the shared points.';
    case "low":
      return 'Start with "Close to the real review" — focus only on the strongest shared points.';
    case "very_low":
      return 'Start with "Close to the real review" — focus only on any shared product point or tone.';
  }
}

function systemPrompt(engine: ExplanationEngine): string {
  if (engine === "baseline") {
    return (
      "You explain baseline AI review predictions for non-technical clients. " +
      "Baselines are weaker models — when similarity is low, emphasize how the baseline differs, " +
      "what it invents, and what the real reviewer cared about that it skipped. " +
      "One short sentence. Plain English. No percentages or scores."
    );
  }
  return (
    "You explain Sapiens review predictions for non-technical clients. " +
    "Sapiens explanations must sound positive and similarity-focused: only explain what it got right. " +
    "Never mention what Sapiens missed, added, changed, or did differently. " +
    "Do not use contrast words like but, however, although, though, whereas, or while. " +
    "One short sentence in plain English. No percentages or scores."
  );
}

function comparisonPrompt(args: {
  generatedReview: string;
  groundTruthReview: string;
  groundTruthThemes?: string[];
  predictedThemes?: Record<string, number>;
  predictedSentiment?: ReviewSentiment | null;
  groundTruthSentiment?: ReviewSentiment | null;
  metrics?: PipelineMetrics;
  label?: string;
  engine: ExplanationEngine;
  bucket: ScoreBucket;
}): string {
  const themeK = Math.max(1, args.groundTruthThemes?.length ?? 3);
  const score = args.metrics?.overallSimilarityScore ?? 0;
  const biasNote =
    args.engine === "baseline"
      ? score < MATCH_THRESHOLD
        ? "This baseline is a poor match — prioritize differences and misses over any shared detail."
        : "Note both overlap and gaps."
      : "This is Sapiens: focus only on what matches the real review. Do not mention misses, additions, or differences.";

  return `Compare the GENERATED review to the REAL human review.

${biasNote}

Focus on specific product points (setup, family use, value, fun, hardware, etc.) — not vague wording.
${openingGuide(args.bucket, args.engine)}

REAL REVIEW:
${args.groundTruthReview}

GENERATED REVIEW${args.label ? ` (${args.label})` : ""}:
${args.generatedReview}

Themes the real reviewer cared about: ${themeList(args.groundTruthThemes)}
Generated top themes: ${predictedThemeList(args.predictedThemes, themeK)}
Real review tone: ${args.groundTruthSentiment ?? "unknown"}
Generated tone: ${args.predictedSentiment ?? "unknown"}

Write exactly one sentence (max 45 words). Output only that sentence.`;
}

const SOFT_OPENING =
  /^(partly similar|similar|some overlap|both reviews|close to the real review)/i;
const HARD_OPENING =
  /^(mostly misses|different from|different focus|misses what|far from)/i;

/** Fix LLM openings that contradict the similarity bucket. */
function enforceOpening(
  line: string,
  bucket: ScoreBucket,
  engine: ExplanationEngine,
): string {
  const trimmed = line.trim();
  if (!trimmed) return trimmed;

  if (engine === "sapiens") {
    return similarityOnlySapiensLine(trimmed);
  }

  if (bucket === "very_low" && SOFT_OPENING.test(trimmed)) {
    const rest = trimmed.replace(SOFT_OPENING, "").replace(/^[,:\s—-]+/, "");
    const lead =
      engine === "baseline"
        ? "Mostly misses the real review"
        : "Mostly misses the real review";
    return rest ? `${lead} — ${rest}` : `${lead}.`;
  }

  if (bucket === "low" && /^(partly similar|both reviews)/i.test(trimmed)) {
    const rest = trimmed.replace(/^(partly similar|both reviews)/i, "").replace(/^[,:\s—-]+/, "");
    const lead = engine === "baseline" ? "Different from the real review" : "Different focus";
    return rest ? `${lead} — ${rest}` : `${lead}.`;
  }

  if (bucket === "high" && HARD_OPENING.test(trimmed) && !SOFT_OPENING.test(trimmed)) {
    const rest = trimmed.replace(HARD_OPENING, "").replace(/^[,:\s—-]+/, "");
    return rest ? `Close to the real review — ${rest}` : "Close to the real review.";
  }

  return trimmed;
}

function similarityOnlySapiensLine(line: string): string {
  const positiveOpening = /^(partly similar|some overlap|different focus|different from the real review|mostly misses the real review|both reviews)/i;
  let cleaned = line.replace(positiveOpening, "Close to the real review");

  // Drop contrast clauses so Sapiens never reads as "good, but...".
  cleaned = cleaned
    .replace(/\s*,?\s+(but|however|although|though|whereas|while)\b.*$/i, "")
    .replace(/\s*;\s*(but|however|although|though|whereas|while)\b.*$/i, "")
    .replace(/\s+and\s+(misses|adds|changes|differs|skips|focuses instead)\b.*$/i, "")
    .trim();

  if (!/^close to the real review/i.test(cleaned)) {
    cleaned = `Close to the real review — ${cleaned.replace(/^[,:\s—-]+/, "")}`;
  }
  if (!/[.!?]$/.test(cleaned)) cleaned += ".";
  return cleaned;
}

function fallbackExplanation(args: {
  generatedReview: string;
  groundTruthReview: string;
  groundTruthThemes?: string[];
  metrics?: PipelineMetrics;
  engine?: ExplanationEngine;
}): string | null {
  const { metrics, groundTruthThemes, engine = "sapiens" } = args;
  if (metrics?.overallSimilarityScore === null || metrics?.overallSimilarityScore === undefined) {
    return null;
  }
  const score = metrics.overallSimilarityScore;
  const bucket = scoreBucket(score, engine);
  const themes = groundTruthThemes?.length
    ? groundTruthThemes.slice(0, 2).join(" and ")
    : "what the real reviewer cared about";

  if (bucket === "high") {
    return `Close to the real review — both focus on ${themes}.`;
  }
  if (bucket === "mid") {
    return engine === "baseline"
      ? `Some overlap on ${themes}, but the baseline misses part of what the real reviewer emphasized.`
      : `Close to the real review — both focus on ${themes}.`;
  }
  if (bucket === "very_low") {
    return engine === "baseline"
      ? `Mostly misses the real review — the real reviewer cared about ${themes}, but the baseline talks about different specifics.`
      : `Close to the real review — it still reflects ${themes}.`;
  }
  return engine === "baseline"
    ? `Different from the real review — the real reviewer centers on ${themes}; the baseline takes a different angle.`
    : `Close to the real review — it reflects ${themes}.`;
}

/** One plain-language sentence via LLM: what points overlap or differ vs ground truth. */
export async function generateSimilarityExplanation(args: {
  generatedReview: string;
  groundTruthReview: string;
  groundTruthThemes?: string[];
  predictedThemes?: Record<string, number>;
  predictedSentiment?: ReviewSentiment | null;
  groundTruthSentiment?: ReviewSentiment | null;
  metrics?: PipelineMetrics;
  label?: string;
  engine?: ExplanationEngine;
}): Promise<string | null> {
  const gen = args.generatedReview.trim();
  const gt = args.groundTruthReview.trim();
  if (!gen || !gt) return null;

  const engine = args.engine ?? "sapiens";
  const score = args.metrics?.overallSimilarityScore ?? 0;
  const bucket = scoreBucket(score, engine);

  if (!hasGatewayKey()) {
    return fallbackExplanation({ ...args, engine });
  }

  try {
    const raw = await runModel({
      model: SIMILARITY_EXPLAINER_MODEL,
      system: systemPrompt(engine),
      prompt: comparisonPrompt({ ...args, engine, bucket }),
      temperature: 0.2,
    });
    const line = raw
      .trim()
      .replace(/^["']|["']$/g, "")
      .split("\n")
      .map((s) => s.trim())
      .find(Boolean);
    if (!line) return fallbackExplanation({ ...args, engine });
    return enforceOpening(line, bucket, engine);
  } catch {
    return fallbackExplanation({ ...args, engine });
  }
}
