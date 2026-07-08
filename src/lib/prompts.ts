import type { BaselineMethod } from "./baselines";
import { getCategoryThemes } from "./category-themes";
import { DEFAULT_THEMES } from "./prompts-constants";
import type { HistoryContextItem, Qualitative, ReviewSentiment } from "./types";
import type { Product, Tribe, User } from "./master";
import { getUserHistoryReview, getUserHistoryThemes } from "./master";
import {
  buildHistoryBaselineContext,
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

function expectedSentimentBlock(sentiment: ReviewSentiment | null | undefined): string {
  if (!sentiment) return "";
  return `### Expected Sentiment
Write this review with an overall **${sentiment}** tone. Your review_text and JSON sentiment field must both reflect **${sentiment}**.

`;
}

function sentimentInstruction(sentiment: ReviewSentiment | null | undefined): string {
  if (!sentiment) return SENTIMENT_INSTRUCTION;
  const toneHint =
    sentiment === "Positive"
      ? "clearly favorable overall; would recommend or repurchase"
      : sentiment === "Negative"
        ? "clearly unfavorable overall; warns against buying"
        : "mixed/balanced, mostly informational, or no clear verdict";
  return `3. Set sentiment to exactly **${sentiment}** — your review_text must match that overall tone (${toneHint}).`;
}

function predictionOutputBlock(
  themes: string[],
  themesKey: "themes" | "predicted_themes",
  sentiment: ReviewSentiment | null = "Positive",
): string {
  return `OUTPUT (JSON only):
{
  "review_text": "...",
  "sentiment": ${JSON.stringify(sentiment ?? "Positive")},
  "${themesKey}": {
${themesJson(themes)}
  }
}`;
}

function themesForCategory(category: string): string[] {
  return getCategoryThemes(category);
}

function userHistorySection(reviewText: string, themes: string[]): string {
  const text = reviewText.trim();
  if (!text && !themes.length) return "";
  const themeBlock = themes.length
    ? `\n**Themes you emphasized:**\n${bullets(themes)}\n`
    : "";
  return `### Your User History
Use your past review writing below as a guide for tone, length, structure, and theme emphasis.

**Review:**
${text || "(none)"}
${themeBlock}
`;
}

/**
 * Healthcare Sapiens — evolved traits + user characteristics + user history.
 */
function buildHealthcareSapiensPromptSections(args: {
  tribe: Tribe;
  user: User;
  product: Product | null;
  productDescription: string;
  category: string;
  excludeReviewKey?: string;
  lengthConstraint: number;
  groundTruthSentiment?: ReviewSentiment | null;
}): string {
  const {
    tribe,
    user,
    product,
    productDescription,
    category,
    lengthConstraint,
    groundTruthSentiment,
  } = args;
  const themes = themesForCategory(category);
  const userCharBlock = formatUserCharacteristics(user, category);
  const tribeTraitsBlock = formatTribeTraitSections(tribe.qualitative);
  const userHistoryReview = getUserHistoryReview(product);
  const userHistoryThemes = getUserHistoryThemes(product);
  const userHistoryBlock = userHistorySection(userHistoryReview, userHistoryThemes);
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

  const expectedSentimentSection = expectedSentimentBlock(groundTruthSentiment);

  return `You are someone who belongs to ${tribe.name}.

Respond ONLY with valid JSON.

${tribeSection}${charSection}### The New Task
You have just purchased and used a new product.

Category: ${category}

**The New Product:** ${productDescription}

${userHistoryBlock}${expectedSentimentSection}### Instructions
1. Write review_text consistent with your user history above — match its tone, similar length, and the same theme emphasis. Shape it with your tribe traits and personal characteristics. Do not miss themes listed in your user history.
2. After writing, infer which category themes are present in your review_text and provide confidence scores (0.0 to 1.0) for EACH theme listed below. Give high scores to themes you covered — especially those from your user history.
${sentimentInstruction(groundTruthSentiment)}

**Category Themes (you MUST score ALL of these):**
${bullets(themes)}

**CRITICAL:**
- Stay consistent with your user history review and its themes
${groundTruthSentiment ? `- Match the expected **${groundTruthSentiment}** sentiment in both review_text and the JSON sentiment field\n` : ""}- Read review_text carefully — scores must match what you wrote
- Theme names must match EXACTLY as shown above (case-sensitive)
- sentiment must be exactly: Positive, Negative, or Neutral
- Do not exceed **${lengthConstraint}** words in review_text

Provide the following in a single JSON object. Respond with *only* the JSON object and nothing else.

${predictionOutputBlock(themes, "predicted_themes", groundTruthSentiment ?? "Positive")}`;
}

/**
 * Video Games Sapiens — evolved traits + user characteristics only (no group summary, no prior reviews).
 */
function buildVideoGamesI0EvolvedPromptSections(args: {
  tribe: Tribe;
  user: User;
  product: Product | null;
  productDescription: string;
  category: string;
  excludeReviewKey?: string;
  lengthConstraint: number;
}): string {
  const { tribe, user, productDescription, category, lengthConstraint } = args;
  const themes = themesForCategory(category);
  const userCharBlock = formatUserCharacteristics(user, category);
  const tribeTraitsBlock = formatTribeTraitSections(tribe.qualitative);
  const tribeSection = tribeTraitsBlock
    ? `---
SECTION 1: Your Tribe (${tribe.name})

**Group traits** — behave like the tribe below while evaluating this product:
${tribeTraitsBlock}

`
    : "";
  const charSection =
    userCharBlock.trim() && userCharBlock !== "(none)"
      ? `---
SECTION 2: Your User Characteristics (you personally)

${userCharBlock}

`
      : "";
  const productSectionNum = !tribeSection && !charSection ? 1 : !tribeSection || !charSection ? 2 : 3;
  const themesSectionNum = productSectionNum + 1;

  return `You are someone from ${tribe.name} — a real person who shops on Amazon and writes honest reviews.

You have NOT seen anyone else's review of this product. You only know the product description, your tribe traits, and your personal user characteristics.

Respond ONLY with valid JSON.

${tribeSection}${charSection}---
SECTION ${productSectionNum}: The Product

Category: ${category}

Product Description:
${productDescription}

---
SECTION ${themesSectionNum}: Themes People Discuss in This Category

${bullets(themes)}

---
YOUR TASK

1. Write review_text that you would actually post for this product — shaped by your tribe traits and personal characteristics.
2. After writing, score EVERY theme in Section ${themesSectionNum} (0.0 to 1.0) based on what you wrote in review_text.
${SENTIMENT_INSTRUCTION}

**CRITICAL:**
- Theme names must match EXACTLY as shown above (case-sensitive)
- sentiment must be exactly: Positive, Negative, or Neutral
- Do not exceed **${lengthConstraint}** words in review_text

Provide the following in a single JSON object. Respond with *only* the JSON object and nothing else.

${predictionOutputBlock(themes, "predicted_themes")}`;
}

/**
 * SAPIENS — tribe traits + user characteristics (+ healthcare user history).
 */
function buildSapiensPromptSections(args: {
  tribe: Tribe;
  user: User;
  product: Product | null;
  productDescription: string;
  category: string;
  excludeReviewKey?: string;
  groundTruthThemes: string[];
  groundTruthSentiment?: ReviewSentiment | null;
  lengthConstraint: number;
}): string {
  if (args.tribe.domain === "healthcare") {
    return buildHealthcareSapiensPromptSections(args);
  }
  return buildVideoGamesI0EvolvedPromptSections(args);
}

export function buildSapiensPrompt(args: {
  tribe: Tribe;
  user: User;
  product: Product | null;
  productDescription: string;
  category: string;
  groundTruthThemes: string[];
  groundTruthSentiment?: ReviewSentiment | null;
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
  groundTruthThemes: string[];
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
2. After writing, infer which category themes are present in your review_text and provide confidence scores (0.0 to 1.0) for EACH theme listed below.
${SENTIMENT_INSTRUCTION}

**Category Themes (you MUST score ALL of these):**
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
  groundTruthThemes: string[];
  populationDefinition?: string;
}): string {
  const { tribe, productDescription, category, populationDefinition } = args;
  const themes = themesForCategory(category);
  const popName = `${category} shoppers`;
  const definition = populationDefinition?.trim() || args.tribe.populationDefinition;
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
2. After writing, infer which category themes are present in your review_text and provide confidence scores (0.0 to 1.0) for EACH theme listed below.
${SENTIMENT_INSTRUCTION}

**Category Themes (you MUST score ALL of these):**
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

const MAX_HISTORY_CONTEXT_REVIEWS = 6;
const MAX_HISTORY_FALLBACK_REVIEWS = 3;

/**
 * User history for the history baseline prompt.
 * Primary: other-category reviews. Fallback: worst 3 history · gpt-5 baseline predictions.
 */
export function buildUserHistoryContext(
  user: User,
  options?: {
    excludeReviewKey?: string;
    excludeReviewText?: string;
    product?: Product | null;
  },
): HistoryContextItem[] {
  const primary = (user.userHistoryReviews ?? [])
    .map((r) => ({ reviewText: r.reviewText.trim() }))
    .filter((r) => r.reviewText.length > 0);
  if (primary.length > 0) return primary.slice(0, MAX_HISTORY_CONTEXT_REVIEWS);

  const excludeText = options?.excludeReviewText?.trim();
  const fallback = (options?.product?.historyBaselineContextReviews ?? [])
    .map((text) => text.trim())
    .filter((text) => text.length > 0 && text !== excludeText)
    .map((reviewText) => ({ reviewText }));

  return fallback.slice(0, MAX_HISTORY_FALLBACK_REVIEWS);
}

export function buildHistoryPrompt(args: {
  personaName: string;
  user: User;
  product: Product | null;
  productDescription: string;
  category: string;
  excludeReviewKey?: string;
  groundTruthThemes: string[];
}): string {
  const { user, productDescription, personaName, category, product, excludeReviewKey } = args;
  const themes = themesForCategory(category);
  const historyItems = buildUserHistoryContext(user, {
    excludeReviewKey,
    excludeReviewText: product?.groundTruthReview,
    product,
  });

  const historyTextBlock = historyItems
    .map((h, i) => `Example ${i + 1}:\n${h.reviewText}\n`)
    .join("\n");

  return `You are someone who belongs to ${personaName}.

### Your User History
To understand how to write this review, analyze the following examples of reviews you have written in the past. Each example is review text only (no product titles or descriptions). Observe the tone, length, and what details you usually focus on.

${historyTextBlock || "(no user history available)"}
### The New Task
You have just purchased and used a new product.
**The New Product:** ${productDescription}

### Instructions
1. Write a review for this new product mimicking the style in the examples.
2. After writing, infer which category themes are present in your review_text and provide confidence scores (0.0 to 1.0) for EACH theme listed below.
${SENTIMENT_INSTRUCTION}

**Category Themes (you MUST score ALL of these):**
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
    groundTruthThemes: string[];
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
        groundTruthThemes: args.groundTruthThemes,
      });
    case "tribe_persona":
      return buildTribePersonaPrompt({
        tribe: args.tribe,
        product: args.product,
        productDescription: args.productDescription,
        category: args.category,
        groundTruthThemes: args.groundTruthThemes,
      });
    case "population_persona":
      return buildPopulationPersonaPrompt({
        tribe: args.tribe,
        product: args.product,
        productDescription: args.productDescription,
        category: args.category,
        groundTruthThemes: args.groundTruthThemes,
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
