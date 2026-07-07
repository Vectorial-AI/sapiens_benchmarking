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
  review_text: string;
  rating?: number | null;
  category: string;
  predicted_themes?: string[];
  sentiment?: string | null;
  user_history_review?: string;
  user_history_themes?: string[];
  best_prediction_review?: string;
  best_prediction_themes?: string[];
  healthcare_benchmark?: boolean;
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
};

export type Product = {
  reviewKey: string;
  productDescription: string;
  category: string;
  rating: number | null;
  groundTruthReview: string;
  predictedThemes: string[];
  groundTruthSentiment: ReviewSentiment | null;
  userHistoryReview?: string;
  userHistoryThemes?: string[];
  healthcareBenchmark?: boolean;
};

/** User history review text for healthcare Sapiens context. */
export function getUserHistoryReview(product: Product | null | undefined): string {
  if (product?.healthcareBenchmark && product.userHistoryReview?.trim()) {
    return product.userHistoryReview.trim();
  }
  return product?.groundTruthReview?.trim() || "";
}

/** Themes from user history (healthcare digital products). */
export function getUserHistoryThemes(product: Product | null | undefined): string[] {
  if (!product?.healthcareBenchmark) return [];
  return (product.userHistoryThemes ?? []).map((t) => t.trim()).filter(Boolean);
}

export type UserHistoryReview = {
  reviewText: string;
  category: string;
  mainCategory: string;
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

function normalizeProduct(r: RawReview): Product {
  return {
    reviewKey: r.review_key,
    productDescription: r.product_description,
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
    healthcareBenchmark: Boolean(r.healthcare_benchmark),
  };
}

function normalizeTribe(raw: RawTribe): Tribe {
  const users: User[] = raw.member_user_characteristics.map((u) => {
    const reviews = raw.members_grouped_by_user[u.user_id] ?? [];
    const products: Product[] = reviews.map(normalizeProduct);
    const userHistoryReviews: UserHistoryReview[] = (
      u.user_history_reviews ?? u.history_noise_reviews ?? []
    )
      .filter((r) => r.review_text?.trim())
      .map((r) => ({
        reviewText: r.review_text.trim(),
        category: r.category ?? "",
        mainCategory: r.main_category ?? r.category ?? "",
      }));
    return {
      id: u.user_id,
      characteristicSummary: u.characteristic_summary,
      categoryCharacteristics: u.category_characteristics ?? {},
      similarityScore: u.similarity_score ?? 0.5,
      products,
      userHistoryReviews,
    };
  });

  if (raw.domain === "healthcare") {
    // Healthcare: most reviews first, then higher similarity (matches build-catalog ordering).
    users.sort(
      (a, b) =>
        b.products.length - a.products.length ||
        b.similarityScore - a.similarityScore,
    );
  } else {
    users.sort((a, b) => b.similarityScore - a.similarityScore);
  }

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
    users: tribe.users.map((u) => ({
      id: u.id,
      characteristicSummary: u.characteristicSummary,
      categoryCharacteristics: u.categoryCharacteristics,
      similarityScore: u.similarityScore,
      products: u.products.map((p) => ({
        reviewKey: p.reviewKey,
        productDescription: p.productDescription,
        category: p.category,
        healthcareBenchmark: p.healthcareBenchmark,
      })),
    })),
  };
}
