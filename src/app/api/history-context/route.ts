import { NextResponse } from "next/server";
import { findContext } from "@/lib/master";
import {
  buildHistoryBaselineContext,
  buildSapiensHistoryContext,
  excludeTargetReviewText,
} from "@/lib/review-history";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tribeId = searchParams.get("tribeId") ?? "";
  const userId = searchParams.get("userId") ?? "";
  const reviewKey = searchParams.get("reviewKey") ?? undefined;
  const categoryParam = searchParams.get("category") ?? undefined;
  const mode = searchParams.get("mode") ?? "history";

  const { tribe, user, product } = findContext(tribeId, userId, reviewKey);
  if (!tribe || !user) {
    return NextResponse.json({ error: "Unknown tribe or user" }, { status: 400 });
  }

  const targetCategory = categoryParam || product?.category || "";

  const items =
    mode === "sapiens"
      ? excludeTargetReviewText(
          buildSapiensHistoryContext({
            products: user.products,
            excludeReviewKey: reviewKey,
            targetCategory,
          }),
          product?.groundTruthReview,
        )
      : buildHistoryBaselineContext({
          products: user.products,
          excludeReviewKey: reviewKey,
        });

  return NextResponse.json({
    items,
    count: items.length,
    targetCategory,
    hasBestPredictionReference: Boolean(product?.bestPredictionReview?.trim()),
  });
}
