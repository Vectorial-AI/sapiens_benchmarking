import { NextResponse } from "next/server";
import { findContext } from "@/lib/master";
import {
  buildHistoryBaselineContext,
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

  const toProduct = user.products.map((p) => ({
    reviewKey: p.reviewKey,
    productDescription: p.productDescription,
    category: p.category,
    groundTruthReview: p.groundTruthReview,
  }));

  const items = excludeTargetReviewText(
    buildHistoryBaselineContext({
      products: toProduct,
      excludeReviewKey: reviewKey,
      targetCategory,
    }),
    product?.groundTruthReview,
  );

  return NextResponse.json({
    items,
    count: items.length,
    targetCategory,
    filter: `Same main category as target (${targetCategory || "unknown"}), leave-one-out`,
  });
}
