import { NextResponse } from "next/server";
import { findContext } from "@/lib/master";
import {
  buildSapiensHistoryContext,
  excludeTargetReviewText,
} from "@/lib/review-history";
import { formatUserCharacteristics } from "@/lib/user-characteristics";

export const runtime = "nodejs";

/** Preview what the Sapiens prompt receives (Sections 2–4 metadata; SGO text never exposed). */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tribeId = searchParams.get("tribeId") ?? "";
  const userId = searchParams.get("userId") ?? "";
  const reviewKey = searchParams.get("reviewKey") ?? undefined;
  const categoryParam = searchParams.get("category") ?? undefined;

  const { tribe, user, product } = findContext(tribeId, userId, reviewKey);
  if (!tribe || !user) {
    return NextResponse.json({ error: "Unknown tribe or user" }, { status: 400 });
  }

  const category = categoryParam || product?.category || "Health & Personal Care";
  const section2Text = formatUserCharacteristics(user, category);
  const section2Populated = section2Text.trim() !== "" && section2Text !== "(none)";

  const historyItems = excludeTargetReviewText(
    buildSapiensHistoryContext({
      products: user.products,
      excludeReviewKey: reviewKey,
      targetCategory: category,
    }),
    product?.groundTruthReview,
  );

  const hasBestPredictionReference = Boolean(product?.bestPredictionReview?.trim());
  const q = tribe.qualitative;

  return NextResponse.json({
    category,
    checklist: {
      section1TribeTraits:
        q.inherentBehavioralTraits.length > 0 || q.latentMotivations.length > 0,
      section2UserCharacteristics: section2Populated,
      section3PriorReviews: historyItems.length > 0,
      section4SgoReference: hasBestPredictionReference,
    },
    section1: {
      tribeName: tribe.name,
      behavioralTraits: q.inherentBehavioralTraits.length,
      motivations: q.latentMotivations.length,
    },
    section2: {
      text: section2Text,
      populated: section2Populated,
    },
    section3: {
      items: historyItems,
      count: historyItems.length,
      filter: `Same main category as target (${category})`,
    },
    section4: {
      hasBestPredictionReference,
      note: hasBestPredictionReference
        ? "SGO best-delta reference is included in the server prompt (text not shown)."
        : "No best_delta_predictions entry for this product in bundled tribe data.",
    },
  });
}
