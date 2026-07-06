/** Leave-one-out review history — mirrors amazon_sgo i0_history_context.py (client-safe). */

import type { HistoryContextItem } from "./types";

export const HEALTH_MAIN_CATEGORY = "Health & Personal Care";
export const DEFAULT_LENGTH_MARGIN_WORDS = 15;
export const MAX_HEALTHCARE_HISTORY_REVIEWS = 2;
export const MAX_CHARS_PER_REVIEW = 900;

export type ReviewHistoryProduct = {
  reviewKey: string;
  productDescription: string;
  category: string;
  groundTruthReview: string;
};

export function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) ?? []).length;
}

/** Max word count = GT words + margin (pipeline default margin = 15). */
export function formatLengthConstraint(
  gtText: string,
  margin = DEFAULT_LENGTH_MARGIN_WORDS,
): number | null {
  const trimmed = gtText.trim();
  if (!trimmed) return null;
  return wordCount(trimmed) + margin;
}

export function isHealthcareCategory(category: string): boolean {
  const c = category.trim();
  return c === HEALTH_MAIN_CATEGORY || c.toLowerCase().includes("health");
}

/**
 * i0 cross-category history for healthcare targets:
 * all non-healthcare reviews + up to N other healthcare reviews (held-out excluded).
 * For non-healthcare targets: all other reviews (leave-one-out).
 */
export function buildSapiensHistoryContext(args: {
  products: ReviewHistoryProduct[];
  excludeReviewKey?: string;
  targetCategory?: string;
  maxHealthcareHistoryReviews?: number;
}): HistoryContextItem[] {
  const {
    products,
    excludeReviewKey,
    targetCategory = "",
    maxHealthcareHistoryReviews = MAX_HEALTHCARE_HISTORY_REVIEWS,
  } = args;

  const candidates = products.filter(
    (p) =>
      p.reviewKey !== excludeReviewKey &&
      p.groundTruthReview.trim().length > 0,
  );

  if (!isHealthcareCategory(targetCategory)) {
    return candidates.map((p) => ({
      productDescription: p.productDescription,
      reviewText: p.groundTruthReview,
    }));
  }

  const nonHealthcare: ReviewHistoryProduct[] = [];
  const healthcare: ReviewHistoryProduct[] = [];
  for (const p of candidates) {
    if (isHealthcareCategory(p.category)) healthcare.push(p);
    else nonHealthcare.push(p);
  }

  const cap = Math.max(0, maxHealthcareHistoryReviews);
  const limitedHealthcare = healthcare.slice(0, cap);
  return [...nonHealthcare, ...limitedHealthcare].map((p) => ({
    productDescription: p.productDescription,
    reviewText: p.groundTruthReview,
  }));
}

/** All other reviews for history baseline (leave-one-out, no category cap). */
export function buildHistoryBaselineContext(args: {
  products: ReviewHistoryProduct[];
  excludeReviewKey?: string;
}): HistoryContextItem[] {
  return args.products
    .filter(
      (p) =>
        p.reviewKey !== args.excludeReviewKey &&
        p.groundTruthReview.trim().length > 0,
    )
    .map((p) => ({
      productDescription: p.productDescription,
      reviewText: p.groundTruthReview,
    }));
}

export function formatReviewHistoryText(
  items: HistoryContextItem[],
  maxCharsPerReview = MAX_CHARS_PER_REVIEW,
): string {
  const rows: string[] = [];
  for (const item of items) {
    let text = item.reviewText.trim();
    if (!text) continue;
    if (text.length > maxCharsPerReview) {
      text = `${text.slice(0, maxCharsPerReview).trimEnd()}…`;
    }
    rows.push(`Example ${rows.length + 1}:\n${text}`);
  }
  return rows.length ? rows.join("\n\n") : "(none available)";
}

/** Ensure held-out target review text never appears in history context. */
export function excludeTargetReviewText(
  items: HistoryContextItem[],
  targetReviewText?: string,
): HistoryContextItem[] {
  const target = targetReviewText?.trim();
  if (!target) return items;
  return items.filter((h) => h.reviewText.trim() !== target);
}
