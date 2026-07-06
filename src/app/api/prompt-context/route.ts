import { NextResponse } from "next/server";
import { getCategoryThemes } from "@/lib/category-themes";
import { findContext } from "@/lib/master";
import { buildHistoryContext } from "@/lib/prompts";
import { formatUserCharacteristics } from "@/lib/user-characteristics";

export const runtime = "nodejs";

/** Preview what the Sapiens prompt receives (tribe traits, user characteristics, prior reviews, reference review, category themes). */
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
  const groundTruthThemes = product?.predictedThemes ?? [];
  const categoryThemes = getCategoryThemes(category);
  const referenceReview = product?.groundTruthReview?.trim() ?? "";

  const historyItems = buildHistoryContext({
    user,
    excludeReviewKey: reviewKey,
    excludeReviewText: product?.groundTruthReview,
    targetCategory: category,
  });

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
      referenceReview: referenceReview.length > 0,
      categoryThemes: categoryThemes.length > 0,
    },
    tribeTraits: {
      behavioralTraits: nonEmpty(q.inherentBehavioralTraits),
      motivations: nonEmpty(q.latentMotivations),
      validationTriggers: nonEmpty(q.validationTriggers),
      frictionPoints: nonEmpty(q.frictionPoints),
      implicitGoals: nonEmpty(q.implicitGoals),
    },
    categoryThemes,
    groundTruthThemes,
    referenceReview: referenceReview || null,
    userCharacteristics: {
      text: userCharacteristics,
      populated: userCharacteristicsPopulated,
    },
    priorReviews: {
      items: historyItems,
      count: historyItems.length,
      filter: `Same main category as target (${category}), leave-one-out`,
    },
  });
}
