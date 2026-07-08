import fs from "fs";
import path from "path";
import catalogIndexJson from "@/data/catalog-index.json";
import type { CatalogTribe, CatalogTribeIndex, Qualitative, ReviewSentiment } from "./types";
import { normalizeSentimentLabel } from "./scoring";

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
  productDescription: string;
  mainProductDescription: string;
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
  sapiensBaselineGap?: number;
  overallSimilarityScore?: number;
  userNormContext?: string;
  leaveOneOutHistoryReviews?: string[];
};

/** Product description aligned with ground-truth review (blind_run target product). */
export function getEffectiveProductDescription(product: Product | null | undefined): string {
  return product?.productDescription?.trim() || product?.mainProductDescription?.trim() || "";
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

function productSortScore(p: Product, sortMode: string): number {
  if (sortMode === "overall_similarity") {
    return p.overallSimilarityScore ?? 0;
  }
  return p.sapiensBaselineGap ?? 0;
}

function normalizeProduct(r: RawReview): Product {
  const mainProductDescription =
    r.main_product_description?.trim() || r.product_description?.trim() || "";
  return {
    reviewKey: r.review_key,
    productDescription: r.product_description,
    mainProductDescription,
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

function normalizeTribe(raw: RawTribe): Tribe {
  const sortMode = raw.catalog_sort_by ?? "baseline_gap";

  const users: User[] = raw.member_user_characteristics.map((u) => {
    const reviews = raw.members_grouped_by_user[u.user_id] ?? [];
    const products: Product[] = reviews.map(normalizeProduct);
    products.sort(
      (a, b) =>
        productSortScore(b, sortMode) - productSortScore(a, sortMode) ||
        a.reviewKey.localeCompare(b.reviewKey),
    );
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

  users.sort((a, b) => b.similarityScore - a.similarityScore);

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
      products: u.products.map((p) => ({
        reviewKey: p.reviewKey,
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
