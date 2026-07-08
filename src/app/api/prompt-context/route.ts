import { NextResponse } from "next/server";
import { getCategoryThemes } from "@/lib/category-themes";
import { findContext, getUserHistoryReview, getUserHistoryThemes, getUserHistoryThemeScores } from "@/lib/master";
import { formatUserCharacteristics } from "@/lib/user-characteristics";
import { formatLengthConstraint, groundTruthLengthConstraint, referenceReviewForLength } from "@/lib/review-history";
import { themeTopKFromGroundTruth } from "@/lib/scoring";

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
  const themeTopK = themeTopKFromGroundTruth(groundTruthThemes);
  const categoryThemes = getCategoryThemes(category);
  const userHistoryReview = getUserHistoryReview(product);
  const userHistoryThemes = getUserHistoryThemes(product);
  const userHistoryThemeScores = getUserHistoryThemeScores(product);
  const leaveOneOutCount = product?.leaveOneOutHistoryReviews?.length ?? 0;
  const userNormPopulated = Boolean(product?.userNormContext?.trim());
  const isHealthcare = tribe.domain === "healthcare";
  const lengthConstraintWords =
    groundTruthLengthConstraint(product) ??
    formatLengthConstraint(referenceReviewForLength(product)) ??
    (!isHealthcare ? 250 : null);

  return NextResponse.json({
    category,
    tribeName: tribe.name,
    domain: tribe.domain,
    deployCheckpoint: tribe.deployCheckpoint ?? null,
    sapiensPromptMode: tribe.sapiensPromptMode ?? null,
    lengthConstraintWords,
    checklist: {
      tribeBehavioralTraits: nonEmpty(q.inherentBehavioralTraits).length > 0,
      tribeMotivations: nonEmpty(q.latentMotivations).length > 0,
      tribeValidationTriggers: nonEmpty(q.validationTriggers).length > 0,
      tribeFrictionPoints: nonEmpty(q.frictionPoints).length > 0,
      tribeImplicitGoals: nonEmpty(q.implicitGoals).length > 0,
      userCharacteristics: userCharacteristicsPopulated,
      userHistory: userHistoryReview.length > 0,
      userHistoryThemes: userHistoryThemes.length > 0,
      userNorms: userNormPopulated,
      leaveOneOutHistory: leaveOneOutCount > 0,
      categoryThemes: categoryThemes.length > 0,
    },
    categoryThemes,
    groundTruthThemes,
    themeTopK,
    userHistory: {
      review: userHistoryReview || null,
      themes: userHistoryThemes,
      themeScores: userHistoryThemeScores,
    },
    userCharacteristics: {
      text: userCharacteristics,
      populated: userCharacteristicsPopulated,
    },
  });
}
