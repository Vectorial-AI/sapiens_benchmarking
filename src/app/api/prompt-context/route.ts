import { NextResponse } from "next/server";
import { findContext } from "@/lib/master";
import {
  buildSapiensHistoryContext,
  excludeTargetReviewText,
} from "@/lib/review-history";
import { formatUserCharacteristics } from "@/lib/user-characteristics";

export const runtime = "nodejs";

/** Preview what the Sapiens prompt receives (tribe traits, user characteristics, prior reviews). */
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
  const userCharacteristics = formatUserCharacteristics(user, category);
  const userCharacteristicsPopulated =
    userCharacteristics.trim() !== "" && userCharacteristics !== "(none)";
  const q = tribe.qualitative;
  const nonEmpty = (items: string[]) => items.map((s) => s.trim()).filter(Boolean);

  const historyItems = excludeTargetReviewText(
    buildSapiensHistoryContext({
      products: user.products,
      excludeReviewKey: reviewKey,
      targetCategory: category,
    }),
    product?.groundTruthReview,
  );

  return NextResponse.json({
    category,
    tribeName: tribe.name,
    checklist: {
      tribeBehavioralTraits: nonEmpty(q.inherentBehavioralTraits).length > 0,
      tribeMotivations: nonEmpty(q.latentMotivations).length > 0,
      tribeValidationTriggers: nonEmpty(q.validationTriggers).length > 0,
      tribeFrictionPoints: nonEmpty(q.frictionPoints).length > 0,
      tribeImplicitGoals: nonEmpty(q.implicitGoals).length > 0,
      userCharacteristics: userCharacteristicsPopulated,
      priorReviews: historyItems.length > 0,
    },
    tribeTraits: {
      behavioralTraits: nonEmpty(q.inherentBehavioralTraits),
      motivations: nonEmpty(q.latentMotivations),
      validationTriggers: nonEmpty(q.validationTriggers),
      frictionPoints: nonEmpty(q.frictionPoints),
      implicitGoals: nonEmpty(q.implicitGoals),
    },
    userCharacteristics: {
      text: userCharacteristics,
      populated: userCharacteristicsPopulated,
    },
    priorReviews: {
      items: historyItems,
      count: historyItems.length,
      filter: `Same main category as target (${category})`,
    },
  });
}
