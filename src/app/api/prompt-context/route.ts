import { NextResponse } from "next/server";
import { getCategoryThemes } from "@/lib/category-themes";
import { findContext, getUserHistoryReview, getUserHistoryThemes } from "@/lib/master";
import { formatUserCharacteristics } from "@/lib/user-characteristics";

export const runtime = "nodejs";

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
  const userHistoryReview = getUserHistoryReview(product);
  const userHistoryThemes = getUserHistoryThemes(product);

  return NextResponse.json({
    category,
    tribeName: tribe.name,
    domain: tribe.domain,
    checklist: {
      tribeBehavioralTraits: nonEmpty(q.inherentBehavioralTraits).length > 0,
      tribeMotivations: nonEmpty(q.latentMotivations).length > 0,
      tribeValidationTriggers: nonEmpty(q.validationTriggers).length > 0,
      tribeFrictionPoints: nonEmpty(q.frictionPoints).length > 0,
      tribeImplicitGoals: nonEmpty(q.implicitGoals).length > 0,
      userCharacteristics: userCharacteristicsPopulated,
      userHistory: userHistoryReview.length > 0,
      userHistoryThemes: userHistoryThemes.length > 0,
      categoryThemes: categoryThemes.length > 0,
    },
    categoryThemes,
    groundTruthThemes,
    userHistory: {
      review: userHistoryReview || null,
      themes: userHistoryThemes,
    },
    userCharacteristics: {
      text: userCharacteristics,
      populated: userCharacteristicsPopulated,
    },
  });
}
