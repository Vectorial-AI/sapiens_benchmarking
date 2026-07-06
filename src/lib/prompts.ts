import type { BaselineMethod } from "./baselines";
import { getCategoryThemes } from "./category-themes";
import { DEFAULT_THEMES } from "./prompts-constants";
import type { HistoryContextItem, Qualitative, ReviewSentiment } from "./types";
import type { Product, Tribe, User } from "./master";
import {
  buildHistoryBaselineContext,
  buildSapiensReviewExamples,
  excludeTargetReviewText,
  formatLengthConstraint,
  wordCount,
} from "./review-history";
import { formatUserCharacteristics } from "./user-characteristics";

export { wordCount, formatLengthConstraint, DEFAULT_THEMES };

export type ParsedPrediction = {
  reviewText: string;
  predictedThemes: Record<string, number>;
  sentiment: ReviewSentiment | null;
};

export const REVIEW_SYSTEM =
  "You are simulating a specific real human writing an honest Amazon review. Stay fully in character and respond ONLY with valid JSON.";

const bullets = (items: string[]) =>
  items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none provided)";

function nonEmptyTraits(items: string[]): string[] {
  return items.map((s) => s.trim()).filter(Boolean);
}

/** Omit empty trait groups — never emit "(none provided)" placeholders. */
function formatTribeTraitSections(q: Qualitative): string {
  const sections: string[] = [];
  const add = (title: string, items: string[]) => {
    const filtered = nonEmptyTraits(items);
    if (filtered.length) {
      sections.push(`**${title}:**\n${filtered.map((i) => `- ${i}`).join("\n")}`);
    }
  };
  add("Inherent Behavioral Traits (DO)", q.inherentBehavioralTraits);
  add("Latent Motivations (DRIVE)", q.latentMotivations);
  add("Validation Triggers", q.validationTriggers);
  add("Friction Points", q.frictionPoints);
  add("Implicit Goals (ACHIEVE)", q.implicitGoals);
  return sections.join("\n\n");
}

function formatHistoryExamples(items: HistoryContextItem[]): string {
  if (!items.length) return "(no prior reviews available)";
  return items.map((h, i) => `Example ${i + 1}:\n${h.reviewText.trim()}\n`).join("\n");
}

const themesJson = (themes: string[]) =>
  themes.map((t) => `    ${JSON.stringify(t)}: 0.0`).join(",\n");

const SENTIMENT_INSTRUCTION = `3. Classify the overall sentiment of your review as exactly one of: Positive, Negative, or Neutral.
   - Positive: clearly favorable overall; would recommend or repurchase
   - Negative: clearly unfavorable overall; warns against buying
   - Neutral: mixed/balanced, mostly informational, or no clear verdict`;

function predictionOutputBlock(themes: string[], themesKey: "themes" | "predicted_themes"): string {
  return `OUTPUT (JSON only):
{
  "review_text": "...",
  "sentiment": "Positive",
  "${themesKey}": {
${themesJson(themes)}
  }
}`;
}

function themesForCategory(category: string): string[] {
  return getCategoryThemes(category);
}

/**
 * SAPIENS — tribe traits (non-empty groups only) + user characteristics + prior-review style.
 */
function buildSapiensPromptSections(args: {
  tribe: Tribe;
  user: User;
  product: Product | null;
  productDescription: string;
  category: string;
  excludeReviewKey?: string;
  lengthConstraint: number;
}): string {
  const { tribe, user, product, productDescription, category, excludeReviewKey, lengthConstraint } =
    args;
  const themes = themesForCategory(category);
  const userCharBlock = formatUserCharacteristics(user, category);
  const tribeTraitsBlock = formatTribeTraitSections(tribe.qualitative);
  const historyItems = buildSapiensReviewExamples({
    products: user.products,
    targetCategory: category,
    reviewKey: excludeReviewKey,
  });
  const historyTextBlock = formatHistoryExamples(historyItems);
  const tribeSection = tribeTraitsBlock
    ? `### Your Tribe (${tribe.name})
Use these group traits when deciding what to notice and how to evaluate the product:

${tribeTraitsBlock}

`
    : "";
  const charSection =
    userCharBlock.trim() && userCharBlock !== "(none)"
      ? `### Who You Are (shopping & reviewing)
${userCharBlock}

`
      : "";

  return `You are someone who belongs to ${tribe.name}.

Respond ONLY with valid JSON.

${tribeSection}${charSection}### Your Writing Style & Preferences
To understand how to write this review, analyze the following examples of reviews you have written in the past. Each example is review text only (no product titles or descriptions). Observe the tone, length, what details you usually focus on, and how your more recent examples read.

${historyTextBlock}
### The New Task
You have just purchased and used a new product.

Category: ${category}

**The New Product:** ${productDescription}

### Instructions
1. Write review_text by **mimicking the style of your prior reviews** above — their tone, length, and which product aspects you actually bother to mention. Let your more recent examples guide how detailed you usually are. Apply your tribe traits and personal characteristics to decide what you notice and how you judge the product — but do not write like a product evaluator or list themes in the prose.
2. Provide confidence scores (0.0 to 1.0) for EACH theme listed below — weight themes the way your example reviews imply you care about different aspects of a product.
${SENTIMENT_INSTRUCTION}

**Available Themes (you MUST score ALL of these):**
${bullets(themes)}

**CRITICAL:**
- Match the voice, length, and specificity of your prior reviews; do not compress into a much shorter or vaguer summary than you normally write
- Read review_text carefully — scores must match what you wrote
- Theme names must match EXACTLY as shown above (case-sensitive)
- sentiment must be exactly: Positive, Negative, or Neutral
- Stay within a similar word count as your examples (do not exceed **${lengthConstraint}** words in review_text)

Provide the following in a single JSON object. Respond with *only* the JSON object and nothing else.

${predictionOutputBlock(themes, "predicted_themes")}`;
}

export function buildSapiensPrompt(args: {
  tribe: Tribe;
  user: User;
  product: Product | null;
  productDescription: string;
  category: string;
  lengthConstraint: number;
  excludeReviewKey?: string;
}): string {
  return buildSapiensPromptSections(args);
}

/**
 * TRIBE PERSONA BASELINE — from Clustering/prompts/tribe_review_prompt_confidence.txt
 * Uses tribe_definition from generate_tribe_definitions.py (NOT evolved traits).
 */
export function buildTribePersonaPrompt(args: {
  tribe: Tribe;
  product: Product | null;
  productDescription: string;
  category: string;
}): string {
  const { tribe, product, productDescription, category } = args;
  const themes = themesForCategory(category);
  return `You are someone who belongs to ${tribe.name}.

Respond ONLY with valid JSON.

---
SECTION 1: Tribe Context

Group Name:
${tribe.name}

Group Description:
${tribe.tribeDefinition}

---
SECTION 2: This Review

Category:
${category}

Product Description:
${productDescription}

---
TASK

1. Write review_text that you would plausibly write for this product.
2. Provide confidence scores (0.0 to 1.0) for EACH theme listed below.
${SENTIMENT_INSTRUCTION}

**Available Themes (you MUST score ALL of these):**
${bullets(themes)}

**CRITICAL:**
- Scores must match what you actually wrote in review_text
- Theme names must match EXACTLY as shown above (case-sensitive)
- sentiment must be exactly: Positive, Negative, or Neutral

${predictionOutputBlock(themes, "themes")}

Generate the review now:`;
}

/**
 * POPULATION PERSONA BASELINE — generic category definition from category_generic_tribe_definitions.json
 */
export function buildPopulationPersonaPrompt(args: {
  tribe: Tribe;
  product: Product | null;
  productDescription: string;
  category: string;
  populationDefinition?: string;
}): string {
  const { tribe, product, productDescription, category, populationDefinition } = args;
  const themes = themesForCategory(category);
  const popName = `${category} shoppers`;
  const definition = populationDefinition?.trim() || tribe.populationDefinition;
  return `You are someone who belongs to ${popName}.

Respond ONLY with valid JSON.

---
SECTION 1: Tribe Context

Group Name:
${popName}

Group Description:
${definition}

---
SECTION 2: This Review

Category:
${category}

Product Description:
${productDescription}

---
TASK

1. Write review_text that you would plausibly write for this product.
2. Provide confidence scores (0.0 to 1.0) for EACH theme listed below.
${SENTIMENT_INSTRUCTION}

**Available Themes (you MUST score ALL of these):**
${bullets(themes)}

**CRITICAL:**
- sentiment must be exactly: Positive, Negative, or Neutral

${predictionOutputBlock(themes, "themes")}

Generate the review now:`;
}

/**
 * HISTORY BASELINE — leave-one-out prior reviews in the same main category as the target.
 */
export function buildHistoryContext(args: {
  user: User;
  excludeReviewKey?: string;
  excludeReviewText?: string;
  targetCategory?: string;
}): HistoryContextItem[] {
  const toHistoryProduct = (p: Product) => ({
    reviewKey: p.reviewKey,
    productDescription: p.productDescription,
    category: p.category,
    groundTruthReview: p.groundTruthReview,
  });
  return excludeTargetReviewText(
    buildHistoryBaselineContext({
      products: args.user.products.map(toHistoryProduct),
      excludeReviewKey: args.excludeReviewKey,
      targetCategory: args.targetCategory,
    }),
    args.excludeReviewText,
  );
}

export function buildHistoryPrompt(args: {
  personaName: string;
  user: User;
  product: Product | null;
  productDescription: string;
  category: string;
  excludeReviewKey?: string;
}): string {
  const { product, productDescription, personaName, category } = args;
  const themes = themesForCategory(category);
  const historyItems = buildHistoryContext({
    ...args,
    excludeReviewText: product?.groundTruthReview,
    targetCategory: category,
  });

  const historyTextBlock = historyItems
    .map((h, i) => `Example ${i + 1}:\n${h.reviewText}\n`)
    .join("\n");

  return `You are someone who belongs to ${personaName}.

### Your Writing Style & Preferences
To understand how to write this review, analyze the following examples of reviews you have written in the past. Each example is review text only (no product titles or descriptions). Observe the tone, length, and what details you usually focus on.

${historyTextBlock || "(no prior reviews available)"}
### The New Task
You have just purchased and used a new product.
**The New Product:** ${productDescription}

### Instructions
1. Write a review for this new product mimicking the style in the examples.
2. Provide confidence scores (0.0 to 1.0) for EACH theme listed below.
${SENTIMENT_INSTRUCTION}

**Available Themes (you MUST score ALL of these):**
${bullets(themes)}

**CRITICAL:**
- Read your review_text carefully - scores must match what you actually wrote
- You MUST provide a score for EVERY theme listed above
- Theme names must match EXACTLY as shown above (case-sensitive)
- sentiment must be exactly: Positive, Negative, or Neutral

Provide the following in a single JSON object. Respond with *only* the JSON object and nothing else.

${predictionOutputBlock(themes, "themes")}`;
}

export function buildBaselinePrompt(
  method: BaselineMethod,
  args: {
    tribe: Tribe;
    user: User;
    product: Product | null;
    productDescription: string;
    category: string;
    excludeReviewKey?: string;
    populationDefinition?: string;
  },
): string {
  switch (method) {
    case "history":
      return buildHistoryPrompt({
        personaName: args.tribe.name,
        user: args.user,
        product: args.product,
        productDescription: args.productDescription,
        category: args.category,
        excludeReviewKey: args.excludeReviewKey,
      });
    case "tribe_persona":
      return buildTribePersonaPrompt({
        tribe: args.tribe,
        product: args.product,
        productDescription: args.productDescription,
        category: args.category,
      });
    case "population_persona":
      return buildPopulationPersonaPrompt({
        tribe: args.tribe,
        product: args.product,
        productDescription: args.productDescription,
        category: args.category,
        populationDefinition: args.populationDefinition,
      });
  }
}

function normalizeSentiment(value: unknown): ReviewSentiment | null {
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  if (s === "positive") return "Positive";
  if (s === "negative") return "Negative";
  if (s === "neutral") return "Neutral";
  return null;
}

function normalizeThemes(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(raw);
    if (!Number.isNaN(n)) out[key] = n;
  }
  return out;
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      const obj = JSON.parse(cleaned.slice(start, end + 1));
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        return obj as Record<string, unknown>;
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Parse review_text, theme scores, and sentiment from a model JSON response. */
export function parsePredictionResponse(raw: string): ParsedPrediction {
  const obj = extractJsonObject(raw);
  if (obj) {
    const reviewText =
      typeof obj.review_text === "string" ? obj.review_text.trim() : "";
    const predictedThemes = normalizeThemes(obj.predicted_themes ?? obj.themes);
    const sentiment = normalizeSentiment(obj.sentiment);
    if (reviewText) {
      return { reviewText, predictedThemes, sentiment };
    }
  }

  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const m = cleaned.match(/"review_text"\s*:\s*"([\s\S]*?)"\s*[,}]/);
  const reviewText = m
    ? m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim()
    : cleaned;

  return { reviewText, predictedThemes: {}, sentiment: null };
}

/** Extract the review_text from a model JSON response (with fallbacks). */
export function parseReviewText(raw: string): string {
  return parsePredictionResponse(raw).reviewText;
}
