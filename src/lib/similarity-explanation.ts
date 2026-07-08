import { hasGatewayKey, runModel } from "./ai";
import type { PipelineMetrics, ReviewSentiment } from "./types";
import { topKThemeEntries } from "./scoring";

export const SIMILARITY_EXPLAINER_MODEL = "openai/gpt-4o-mini";

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

function fallbackExplanation(args: {
  generatedReview: string;
  groundTruthReview: string;
  groundTruthThemes?: string[];
  metrics?: PipelineMetrics;
}): string | null {
  const { metrics, groundTruthThemes } = args;
  if (metrics?.overallSimilarityScore === null || metrics?.overallSimilarityScore === undefined) {
    return null;
  }
  const score = metrics?.overallSimilarityScore ?? 0;
  const themes = groundTruthThemes?.length
    ? groundTruthThemes.slice(0, 2).join(" and ")
    : "the same product angles";
  if (score >= 0.75) {
    return `Both reviews focus on ${themes} in a similar way.`;
  }
  if (score >= 0.5) {
    return `Some overlap on ${themes}, but the generated review misses part of what the real reviewer emphasized.`;
  }
  return `The real review centers on ${themes}; the generated review talks about different specifics.`;
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
}): Promise<string | null> {
  const gen = args.generatedReview.trim();
  const gt = args.groundTruthReview.trim();
  if (!gen || !gt) return null;

  if (!hasGatewayKey()) {
    return fallbackExplanation(args);
  }

  const themeK = Math.max(1, args.groundTruthThemes?.length ?? 3);
  const system =
    "You explain review comparisons for business clients who are not technical. " +
    "Write one short sentence in plain English. No percentages, scores, or metric jargon.";

  const prompt = `Compare the GENERATED review to the REAL human review.

Focus on specific points both mention (or miss):
- product aspects, experiences, pros/cons, setup, value, quality, etc.
- say WHAT overlaps in substance, not vague phrases like "similar wording"
- if they differ, say what the real reviewer cared about vs what the generated one emphasizes

REAL REVIEW:
${gt}

GENERATED REVIEW${args.label ? ` (${args.label})` : ""}:
${gen}

Themes the real reviewer cared about: ${themeList(args.groundTruthThemes)}
Generated top themes: ${predictedThemeList(args.predictedThemes, themeK)}
Real review tone: ${args.groundTruthSentiment ?? "unknown"}
Generated tone: ${args.predictedSentiment ?? "unknown"}

Write exactly one sentence (max 40 words). Start with "Both reviews" if very similar, "Partly similar" if mixed, or "Different focus" if they diverge. Output only that sentence.`;

  try {
    const raw = await runModel({
      model: SIMILARITY_EXPLAINER_MODEL,
      system,
      prompt,
      temperature: 0.2,
    });
    const line = raw
      .trim()
      .replace(/^["']|["']$/g, "")
      .split("\n")
      .map((s) => s.trim())
      .find(Boolean);
    return line ?? fallbackExplanation(args);
  } catch {
    return fallbackExplanation(args);
  }
}
