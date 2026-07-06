/** Leave-one-out review history for Sapiens prompts (client-safe). */

import type { HistoryContextItem } from "./types";
import { mapCategoryToMain } from "./category-themes";

export const DEFAULT_LENGTH_MARGIN_WORDS = 15;
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

/**
 * Same main category as the target product, leave-one-out.
 * E.g. Video Games → all other Video Games reviews; Health & Personal Care → all other HPC reviews.
 */
export function buildSapiensHistoryContext(args: {
  products: ReviewHistoryProduct[];
  excludeReviewKey?: string;
  targetCategory?: string;
}): HistoryContextItem[] {
  const { products, excludeReviewKey, targetCategory = "" } = args;
  const targetMain = mapCategoryToMain(targetCategory);

  return products
    .filter(
      (p) =>
        p.reviewKey !== excludeReviewKey &&
        p.groundTruthReview.trim().length > 0 &&
        mapCategoryToMain(p.category) === targetMain,
    )
    .map((p) => ({
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
