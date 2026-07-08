import explanationsJson from "@/data/sapiens-baseline-explanations.json";
import type { BaselineMethod } from "./baselines";
import type { SapiensBaselineExplanation, SapiensExplanationContent } from "./types";

type RawExplanationFile = Record<
  string,
  {
    review_key: string;
    product_description: string;
    sapiens_overall_similarity?: number | null;
    sapiens_baseline_gap?: number | null;
    best_baseline?: {
      method?: string;
      model?: string;
      overall_similarity?: number | null;
      review_text?: string;
    };
    explanation?: SapiensExplanationContent;
  }
>;

const RAW = explanationsJson as RawExplanationFile;

function normalize(row: RawExplanationFile[string]): SapiensBaselineExplanation | null {
  if (!row?.review_key || !row.explanation) return null;
  const best = row.best_baseline ?? {};
  return {
    reviewKey: row.review_key,
    productDescription: row.product_description ?? "",
    sapiensOverallSimilarity: row.sapiens_overall_similarity ?? null,
    sapiensBaselineGap: row.sapiens_baseline_gap ?? null,
    bestBaseline: {
      method: (best.method ?? "history") as BaselineMethod | string,
      model: best.model ?? "unknown",
      overallSimilarity: best.overall_similarity ?? null,
      reviewText: best.review_text ?? "",
    },
    explanation: row.explanation,
  };
}

const INDEX = new Map<string, SapiensBaselineExplanation>();
for (const row of Object.values(RAW)) {
  const item = normalize(row);
  if (item) INDEX.set(item.reviewKey, item);
}

export function getSapiensBaselineExplanation(
  reviewKey: string | null | undefined,
): SapiensBaselineExplanation | null {
  if (!reviewKey) return null;
  return INDEX.get(reviewKey) ?? null;
}

export function listSapiensBaselineExplanationKeys(): string[] {
  return [...INDEX.keys()];
}
