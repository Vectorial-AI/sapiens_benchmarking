import fs from "fs";
import path from "path";
import catalogIndexJson from "@/data/catalog-index.json";
import productTitlesJson from "@/data/product_titles.json";
import type { CatalogTribe, CatalogTribeIndex, Qualitative, ReviewSentiment } from "./types";
import { normalizeSentimentLabel } from "./scoring";
import { wordCount } from "./review-history";

/** Ground-truth reviews shorter than this stay in catalog but are demoted in sort order. */
const MIN_GROUND_TRUTH_WORDS = 35;

/** review_key -> static UI product title */
const PRODUCT_TITLES: Record<string, string> =
  typeof productTitlesJson === "object" &&
  productTitlesJson !== null &&
  "titles" in productTitlesJson &&
  typeof (productTitlesJson as { titles?: unknown }).titles === "object"
    ? ((productTitlesJson as { titles: Record<string, string> }).titles ?? {})
    : {};

/** Raw shapes from tribe JSON files. */
type RawTrait = { text: string };
type RawReview = {
  review_key: string;
  product_description: string;
  main_product_description?: string;
  review_text: string;
  rating?: number | null;
  category: string;
  predicted_themes?: string[];
  sentiment?: string | null;
  user_history_review?: string;
  user_history_themes?: string[];
  user_history_theme_scores?: Record<string, number>;
  history_baseline_context_reviews?: Array<string | { review_text: string; rank_score?: number }>;
  best_prediction_review?: string;
  best_prediction_themes?: string[];
  healthcare_benchmark?: boolean;
  video_games_benchmark?: boolean;
  catalog_priority_tier?: string;
  review_word_count?: number;
  sapiens_baseline_gap?: number;
  overall_similarity_score?: number;
  user_norm_context?: string;
  leave_one_out_history_reviews?: Array<string | { review_text: string }>;
};
type RawTribe = {
  id: string;
  cluster: string;
  micro_id: string;
  domain?: "healthcare" | "video_games";
  tribe_name: string;
  tribe_description: string;
  tribe_definition: string;
  population_definition: string;
  trait_source: string;
  deploy_checkpoint?: string;
  deploy_iteration?: number;
  sapiens_prompt_mode?: string;
  catalog_sort_by?: string;
  data_sources?: {
    users: string;
    products: string;
    similarity: string;
    traits: string;
  };
  qualitative_summary: {
    inherent_behavioral_traits?: RawTrait[];
    latent_motivations?: { main?: RawTrait[] };
    validation_triggers?: string[];
    friction_points?: string[];
    implicit_goals?: RawTrait[];
  };
  member_user_characteristics: {
    user_id: string;
    characteristic_summary: string;
    category_characteristics?: Record<string, string>;
    similarity_score?: number;
    user_history_reviews?: RawUserHistoryReview[];
    history_noise_reviews?: RawUserHistoryReview[];
  }[];
  members_grouped_by_user: Record<string, RawReview[]>;
};

type RawUserHistoryReview = {
  review_text: string;
  category?: string;
  main_category?: string;
  review_key?: string;
};

export type Product = {
  reviewKey: string;
  productTitle?: string;
  productDescription: string;
  mainProductDescription?: string;
  category: string;
  rating: number | null;
  groundTruthReview: string;
  predictedThemes: string[];
  groundTruthSentiment: ReviewSentiment | null;
  userHistoryReview?: string;
  userHistoryThemes?: string[];
  userHistoryThemeScores?: Record<string, number>;
  historyBaselineContextReviews?: string[];
  healthcareBenchmark?: boolean;
  videoGamesBenchmark?: boolean;
  catalogPriorityTier?: "high" | "medium" | "low";
  reviewWordCount?: number;
  sapiensBaselineGap?: number;
  overallSimilarityScore?: number;
  userNormContext?: string;
  leaveOneOutHistoryReviews?: string[];
};

/** Prompt/scoring — product_description only. */
export function getEffectiveProductDescription(product: Product | null | undefined): string {
  return product?.productDescription?.trim() || "";
}

function fallbackProductTitle(description: string): string {
  const text = description.trim();
  if (!text) return "Untitled product";
  const firstLine = text.split(/\n|\. /)[0]?.trim() || text;
  if (firstLine.length <= 160) return firstLine;
  const cut = firstLine.slice(0, 157).trim();
  return `${cut.slice(0, cut.lastIndexOf(" ")).trim()}…`;
}

function resolveProductTitle(reviewKey: string, description: string): string {
  const titled = PRODUCT_TITLES[reviewKey]?.trim();
  if (titled) return titled;
  return fallbackProductTitle(description);
}

/** User history review text for healthcare Sapiens context. */
export function getUserHistoryReview(product: Product | null | undefined): string {
  if (product?.healthcareBenchmark && product.userHistoryReview?.trim()) {
    return product.userHistoryReview.trim();
  }
  return product?.groundTruthReview?.trim() || "";
}

/** Theme names from the reference / best prediction (healthcare benchmark). */
export function getUserHistoryThemes(product: Product | null | undefined): string[] {
  if (!product?.healthcareBenchmark) return [];
  return (product.userHistoryThemes ?? []).map((t) => t.trim()).filter(Boolean);
}

/** Full theme score map from the reference / best prediction (healthcare benchmark). */
export function getUserHistoryThemeScores(
  product: Product | null | undefined,
): Record<string, number> {
  if (!product?.healthcareBenchmark) return {};
  return product.userHistoryThemeScores ?? {};
}

export type UserHistoryReview = {
  reviewText: string;
  category: string;
  mainCategory: string;
  reviewKey?: string;
};

export type User = {
  id: string;
  characteristicSummary: string;
  categoryCharacteristics: Record<string, string>;
  similarityScore: number;
  products: Product[];
  userHistoryReviews: UserHistoryReview[];
};

export type Tribe = {
  id: string;
  cluster: string;
  microId: string;
  domain?: "healthcare" | "video_games";
  name: string;
  description: string;
  tribeDefinition: string;
  populationDefinition: string;
  traitSource: string;
  dataSources?: {
    users: string;
    products: string;
    similarity: string;
    traits: string;
  };
  sapiensPromptMode?: string;
  deployCheckpoint?: string;
  deployIteration?: number;
  qualitative: Qualitative;
  users: User[];
};

const DATA_DIR = path.join(process.cwd(), "src/data");

function normalizeQualitative(raw: RawTribe["qualitative_summary"]): Qualitative {
  const q = raw ?? {};
  return {
    inherentBehavioralTraits: (q.inherent_behavioral_traits ?? []).map((t) => t.text),
    latentMotivations: (q.latent_motivations?.main ?? []).map((t) => t.text),
    validationTriggers: q.validation_triggers ?? [],
    frictionPoints: q.friction_points ?? [],
    implicitGoals: (q.implicit_goals ?? []).map((t) => t.text),
  };
}

const PRIORITY_TIER_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function priorityTierOrder(tier: string | undefined): number {
  return PRIORITY_TIER_ORDER[(tier ?? "medium").toLowerCase()] ?? 1;
}

function productWordCount(product: Product): number {
  return product.reviewWordCount ?? wordCount(product.groundTruthReview);
}

function groundTruthLengthRank(product: Product): number {
  return productWordCount(product) >= MIN_GROUND_TRUTH_WORDS ? 0 : 1;
}

function showcaseTierRank(tier: string | undefined): number {
  return tier === "low" ? 1 : 0;
}

function isShowcaseProduct(product: Product): boolean {
  return showcaseTierRank(product.catalogPriorityTier) === 0;
}

function productSortScore(p: Product, sortMode: string): number {
  if (sortMode === "overall_similarity") {
    return p.overallSimilarityScore ?? 0;
  }
  return p.sapiensBaselineGap ?? 0;
}

function compareProducts(a: Product, b: Product, sortMode: string): number {
  if (sortMode === "priority_tier_gap") {
    const showcaseDiff =
      showcaseTierRank(a.catalogPriorityTier) - showcaseTierRank(b.catalogPriorityTier);
    if (showcaseDiff !== 0) return showcaseDiff;

    const gapDiff = productSortScore(b, sortMode) - productSortScore(a, sortMode);
    if (gapDiff !== 0) return gapDiff;

    const lengthDiff = groundTruthLengthRank(a) - groundTruthLengthRank(b);
    if (lengthDiff !== 0) return lengthDiff;

    const tierDiff =
      priorityTierOrder(a.catalogPriorityTier) - priorityTierOrder(b.catalogPriorityTier);
    if (tierDiff !== 0) return tierDiff;

    return productWordCount(b) - productWordCount(a) || a.reviewKey.localeCompare(b.reviewKey);
  }

  return (
    productSortScore(b, sortMode) - productSortScore(a, sortMode) ||
    groundTruthLengthRank(a) - groundTruthLengthRank(b) ||
    productWordCount(b) - productWordCount(a) ||
    a.reviewKey.localeCompare(b.reviewKey)
  );
}

function userShowcaseStats(user: User): {
  showcaseBand: number;
  maxShowcaseGap: number;
  hasLong: number;
  maxGap: number;
} {
  const showcase = user.products.filter(isShowcaseProduct);
  const longPool = showcase.length ? showcase : user.products;
  const showcaseGaps = showcase.map((p) => p.sapiensBaselineGap ?? 0);
  const allGaps = user.products.map((p) => p.sapiensBaselineGap ?? 0);
  return {
    showcaseBand: showcase.length > 0 ? 0 : 1,
    maxShowcaseGap: showcaseGaps.length ? Math.max(...showcaseGaps) : 0,
    hasLong: longPool.some((p) => groundTruthLengthRank(p) === 0) ? 0 : 1,
    maxGap: allGaps.length ? Math.max(...allGaps) : 0,
  };
}

function compareUsers(a: User, b: User, sortMode: string): number {
  if (sortMode === "priority_tier_gap") {
    const aStats = userShowcaseStats(a);
    const bStats = userShowcaseStats(b);
    return (
      aStats.showcaseBand - bStats.showcaseBand ||
      bStats.maxShowcaseGap - aStats.maxShowcaseGap ||
      aStats.hasLong - bStats.hasLong ||
      bStats.maxGap - aStats.maxGap ||
      b.similarityScore - a.similarityScore ||
      a.id.localeCompare(b.id)
    );
  }

  const aStats = userShowcaseStats(a);
  const bStats = userShowcaseStats(b);
  return (
    bStats.maxGap - aStats.maxGap ||
    aStats.hasLong - bStats.hasLong ||
    b.similarityScore - a.similarityScore ||
    a.id.localeCompare(b.id)
  );
}

function normalizeProduct(r: RawReview, domain?: "healthcare" | "video_games"): Product {
  const productDescription = r.product_description?.trim() || "";
  const mainProductDescription =
    r.main_product_description?.trim() || productDescription;
  const product: Product = {
    reviewKey: r.review_key,
    productDescription,
    category: r.category,
    rating: typeof r.rating === "number" ? r.rating : null,
    groundTruthReview: r.review_text,
    predictedThemes: r.predicted_themes ?? [],
    groundTruthSentiment: normalizeSentimentLabel(r.sentiment),
    userHistoryReview:
      (r.user_history_review ?? r.best_prediction_review)?.trim() || undefined,
    userHistoryThemes: (r.user_history_themes ?? r.best_prediction_themes)?.length
      ? (r.user_history_themes ?? r.best_prediction_themes)
      : undefined,
    userHistoryThemeScores: r.user_history_theme_scores,
    historyBaselineContextReviews: (r.history_baseline_context_reviews ?? [])
      .map((item) => {
        if (typeof item === "string") return item.trim();
        return String(item.review_text ?? "").trim();
      })
      .filter(Boolean),
    healthcareBenchmark: Boolean(r.healthcare_benchmark),
    videoGamesBenchmark: Boolean(r.video_games_benchmark),
    catalogPriorityTier: normalizePriorityTier(r.catalog_priority_tier),
    reviewWordCount:
      typeof r.review_word_count === "number"
        ? r.review_word_count
        : wordCount(r.review_text),
    sapiensBaselineGap:
      typeof r.sapiens_baseline_gap === "number" ? r.sapiens_baseline_gap : undefined,
    overallSimilarityScore:
      typeof r.overall_similarity_score === "number"
        ? r.overall_similarity_score
        : undefined,
    userNormContext: r.user_norm_context?.trim() || undefined,
    leaveOneOutHistoryReviews: (r.leave_one_out_history_reviews ?? [])
      .map((item) => {
        if (typeof item === "string") return item.trim();
        return String(item.review_text ?? "").trim();
      })
      .filter(Boolean),
  };
  if (domain === "video_games") {
    product.productTitle = resolveProductTitle(r.review_key, productDescription);
  } else if (domain === "healthcare") {
    product.mainProductDescription = mainProductDescription;
  }
  return product;
}

function normalizeUserHistoryReviews(
  rows: RawUserHistoryReview[] | undefined,
): UserHistoryReview[] {
  return (rows ?? [])
    .filter((r) => r.review_text?.trim())
    .map((r) => ({
      reviewText: r.review_text.trim(),
      category: r.category ?? "",
      mainCategory: r.main_category ?? r.category ?? "",
      reviewKey: r.review_key?.trim() || undefined,
    }));
}

function normalizePriorityTier(value: string | undefined): "high" | "medium" | "low" | undefined {
  const tier = value?.trim().toLowerCase();
  if (tier === "high" || tier === "medium" || tier === "low") return tier;
  return undefined;
}

function normalizeTribe(raw: RawTribe): Tribe {
  const sortMode = raw.catalog_sort_by ?? "baseline_gap";

  const users: User[] = raw.member_user_characteristics.map((u) => {
    const reviews = raw.members_grouped_by_user[u.user_id] ?? [];
    const products: Product[] = reviews.map((r) => normalizeProduct(r, raw.domain));
    products.sort((a, b) => compareProducts(a, b, sortMode));
    const userHistoryReviews = normalizeUserHistoryReviews(
      u.user_history_reviews ?? u.history_noise_reviews,
    );
    return {
      id: u.user_id,
      characteristicSummary: u.characteristic_summary,
      categoryCharacteristics: u.category_characteristics ?? {},
      similarityScore: u.similarity_score ?? 0.5,
      products,
      userHistoryReviews,
    };
  });

  users.sort((a, b) => compareUsers(a, b, sortMode));

  return {
    id: raw.id,
    cluster: raw.cluster,
    microId: raw.micro_id,
    domain: raw.domain,
    name: raw.tribe_name,
    description: raw.tribe_definition?.trim() || raw.tribe_description,
    tribeDefinition: raw.tribe_definition,
    populationDefinition: raw.population_definition,
    traitSource: raw.trait_source,
    dataSources: raw.data_sources,
    sapiensPromptMode: raw.sapiens_prompt_mode,
    deployCheckpoint: raw.deploy_checkpoint,
    deployIteration: raw.deploy_iteration,
    qualitative: normalizeQualitative(raw.qualitative_summary),
    users,
  };
}

let indexCache: { tribes: CatalogTribeIndex[] } | null = null;
const tribeCache = new Map<string, Tribe>();

export function getCatalogIndex(): { tribes: CatalogTribeIndex[] } {
  if (indexCache) return indexCache;
  indexCache = catalogIndexJson as { tribes: CatalogTribeIndex[] };
  return indexCache;
}

export function getTribe(id: string): Tribe | undefined {
  if (tribeCache.has(id)) return tribeCache.get(id);
  const filePath = path.join(DATA_DIR, "tribes", `${id}.json`);
  if (!fs.existsSync(filePath)) return undefined;
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as RawTribe;
  const tribe = normalizeTribe(raw);
  tribeCache.set(id, tribe);
  return tribe;
}

export function findContext(tribeId: string, userId: string, reviewKey?: string) {
  const tribe = getTribe(tribeId);
  const user = tribe?.users.find((u) => u.id === userId);
  const product = reviewKey
    ? user?.products.find((p) => p.reviewKey === reviewKey)
    : undefined;
  return { tribe, user, product };
}

/** Slim catalog index for tribe picker (step 0). */
export function getCatalog(): CatalogTribeIndex[] {
  return getCatalogIndex().tribes;
}

/** Full tribe with users/products but no ground-truth review text. */
export function getCatalogTribe(id: string): CatalogTribe | undefined {
  const tribe = getTribe(id);
  const idx = getCatalogIndex().tribes.find((t) => t.id === id);
  if (!tribe || !idx) return undefined;
  return {
    ...idx,
    qualitative: tribe.qualitative,
    tribeDefinition: tribe.tribeDefinition,
    populationDefinition: tribe.populationDefinition,
    dataSources: tribe.dataSources ?? idx.dataSources,
    sapiensPromptMode: tribe.sapiensPromptMode ?? idx.sapiensPromptMode,
    deployCheckpoint: tribe.deployCheckpoint ?? idx.deployCheckpoint,
    deployIteration: tribe.deployIteration ?? idx.deployIteration,
    users: tribe.users.map((u) => ({
      id: u.id,
      characteristicSummary: u.characteristicSummary,
      categoryCharacteristics: u.categoryCharacteristics,
      similarityScore: u.similarityScore,
      userHistoryReviews: u.userHistoryReviews.map((r) => ({
        reviewText: r.reviewText,
        category: r.category,
        mainCategory: r.mainCategory,
        reviewKey: r.reviewKey,
      })),
      products: u.products.map((p) => ({
        reviewKey: p.reviewKey,
        productTitle: p.productTitle,
        productDescription: p.productDescription,
        mainProductDescription: p.mainProductDescription,
        category: p.category,
        groundTruthThemes: p.predictedThemes,
        groundTruthSentiment: p.groundTruthSentiment,
        healthcareBenchmark: p.healthcareBenchmark,
        videoGamesBenchmark: p.videoGamesBenchmark,
        sapiensBaselineGap: p.sapiensBaselineGap,
        overallSimilarityScore: p.overallSimilarityScore,
      })),
    })),
  };
}
