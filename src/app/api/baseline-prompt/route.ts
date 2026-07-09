import { NextResponse } from "next/server";
import { BASELINE_METHODS, type BaselineMethod } from "@/lib/baselines";
import { findContext } from "@/lib/master";
import {
  REVIEW_SYSTEM,
  buildBaselinePrompt,
  buildUserHistoryContext,
} from "@/lib/prompts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  const {
    tribeId,
    userId,
    reviewKey,
    productDescription: customDesc,
    category: customCategory,
    baselineMethod,
    populationDefinition,
    tribeDefinition,
  } = body as {
    tribeId: string;
    userId: string;
    reviewKey?: string;
    productDescription?: string;
    category?: string;
    baselineMethod: BaselineMethod;
    populationDefinition?: string;
    tribeDefinition?: string;
  };

  if (!baselineMethod || !BASELINE_METHODS.includes(baselineMethod)) {
    return NextResponse.json({ error: "Invalid baseline method" }, { status: 400 });
  }

  const context = findContext(tribeId, userId, reviewKey);
  if (!context.tribe || !context.user) {
    return NextResponse.json({ error: "Unknown tribe or user" }, { status: 400 });
  }

  const productDescription = (
    customDesc?.trim() ||
    context.product?.productDescription ||
    ""
  ).trim();
  if (!productDescription) {
    return NextResponse.json(
      { error: "A product description is required" },
      { status: 400 },
    );
  }

  const category = customCategory || context.product?.category || "Health & Personal Care";
  const groundTruthThemes = context.product?.predictedThemes ?? [];

  const prompt = buildBaselinePrompt(baselineMethod, {
    tribe: context.tribe,
    user: context.user,
    product: context.product ?? null,
    productDescription,
    category,
    excludeReviewKey: reviewKey,
    groundTruthThemes,
    populationDefinition: populationDefinition?.trim() || undefined,
    tribeDefinition: tribeDefinition?.trim() || undefined,
    useHistoryPlaceholder: baselineMethod === "history",
  });

  const historyContext =
    baselineMethod === "history"
      ? buildUserHistoryContext(context.user, {
          excludeReviewKey: reviewKey,
          excludeReviewText: context.product?.groundTruthReview,
          product: context.product ?? null,
        })
      : undefined;

  return NextResponse.json({
    prompt,
    system: REVIEW_SYSTEM,
    historyContext,
    tribeDefinition:
      tribeDefinition?.trim() ||
      context.tribe.tribeDefinition?.trim() ||
      context.tribe.description?.trim() ||
      "",
    populationDefinition:
      populationDefinition?.trim() ||
      context.tribe.populationDefinition?.trim() ||
      "",
  });
}
