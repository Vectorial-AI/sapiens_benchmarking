import type { BaselineMethod } from "./baselines";
import type { HistoryContextItem, ReviewSentiment } from "./types";
import type { Product, Tribe, User } from "./master";

export type ParsedPrediction = {
  reviewText: string;
  predictedThemes: Record<string, number>;
  sentiment: ReviewSentiment | null;
};

export const DEFAULT_THEMES = [
  "Effectiveness & Precision",
  "Ease of Use & Convenience",
  "Value for Money",
  "Quality & Durability",
  "Safety & Health Considerations",
];

export const REVIEW_SYSTEM =
  "You are simulating a specific real human writing an honest Amazon review. Stay fully in character and respond ONLY with valid JSON.";

const bullets = (items: string[]) =>
  items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none provided)";

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

export function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) ?? []).length;
}

function themesFor(product: Product | null): string[] {
  const t = product?.predictedThemes ?? [];
  return t.length ? t : DEFAULT_THEMES;
}

/**
 * SAPIENS — evolved tribe traits + user characteristics.
 * Aligned with amazon_sgo_pipeline_service/prompts/amazon/i0_initial_prediction_confidence_amazon.txt
 */
export function buildSapiensPrompt(args: {
  tribe: Tribe;
  user: User;
  product: Product | null;
  productDescription: string;
  category: string;
  lengthConstraint: number;
}): string {
  const { tribe, user, product, productDescription, category } = args;
  const q = tribe.qualitative;
  const themes = themesFor(product);

  return `You are someone from ${tribe.name} — a real person who shops on Amazon and writes honest reviews.

You have NOT seen anyone else's review of this product. You only know the product description, your tribe profile (Section 1), and your personal user characteristics (Section 2).

Respond ONLY with valid JSON.

---
SECTION 1: Your Tribe (group profile)

**1A. Group summary** — the big picture of your tribe:
${tribe.description}

**Group traits** — as you evaluate this product, behave like the tribe below.

**Inherent Behavioral Traits (DO):**
${bullets(q.inherentBehavioralTraits)}

**Latent Motivations (DRIVE):**
${bullets(q.latentMotivations)}

**Validation Triggers (win signals):**
${bullets(q.validationTriggers)}

**Friction Points (deal-breakers):**
${bullets(q.frictionPoints)}

**Implicit Goals (ACHIEVE):**
${bullets(q.implicitGoals)}

---
SECTION 2: Your User Characteristics (you personally)

${user.characteristicSummary}

---
SECTION 3: The Product

Category: ${category}

Product Description:
${productDescription}

---
SECTION 4: Themes People Discuss in This Category

${bullets(themes)}

---
YOUR TASK
1. Write a realistic first-person review_text this user would ACTUALLY post — natural voice, flowing paragraphs, no headings, no pros/cons lists, no theme labels.
2. Score EVERY theme in Section 4 (0.0–1.0) to match what your review reflects.
${SENTIMENT_INSTRUCTION}

Make sure not to cross the review ${args.lengthConstraint} words.

${predictionOutputBlock(themes, "predicted_themes")}

Write your review now:`;
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
  const themes = themesFor(product);
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
  const themes = themesFor(product);
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
 * HISTORY BASELINE — leave-one-out: ALL other reviews for this user (no cap).
 * Matches Clustering/prediction_micro_cluster_history.py:
 *   history_reviews = reviews[:review_index] + reviews[review_index + 1:]
 * Prompt from create_prompt_confidence() — review text only in examples.
 */
export function buildHistoryContext(args: {
  user: User;
  excludeReviewKey?: string;
}): HistoryContextItem[] {
  return args.user.products
    .filter((p) => p.reviewKey !== args.excludeReviewKey)
    .map((p) => ({
      productDescription: p.productDescription,
      reviewText: p.groundTruthReview,
    }));
}

export function buildHistoryPrompt(args: {
  personaName: string;
  user: User;
  product: Product | null;
  productDescription: string;
  excludeReviewKey?: string;
}): string {
  const { product, productDescription, personaName } = args;
  const themes = themesFor(product);
  const historyItems = buildHistoryContext(args);

  const historyTextBlock = historyItems
    .map((h, i) => `Example ${i + 1}:\n${h.reviewText}\n`)
    .join("\n");

  return `You are someone who belongs to ${personaName}.

### Your Writing Style & Preferences
To understand how to write this review, analyze the following examples of reviews you have written in the past. Observe the tone, length, and what details you usually focus on.

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
