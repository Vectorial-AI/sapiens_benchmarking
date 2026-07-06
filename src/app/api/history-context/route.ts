import { NextResponse } from "next/server";
import { findContext } from "@/lib/master";
import {
  buildHistoryBaselineContext,
  buildSapiensHistoryContext,
} from "@/lib/review-history";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tribeId = searchParams.get("tribeId") ?? "";
  const userId = searchParams.get("userId") ?? "";
  const reviewKey = searchParams.get("reviewKey") ?? undefined;
  const mode = searchParams.get("mode") ?? "history";

  const { tribe, user, product } = findContext(tribeId, userId, reviewKey);
  if (!tribe || !user) {
    return NextResponse.json({ error: "Unknown tribe or user" }, { status: 400 });
  }

  const items =
    mode === "sapiens"
      ? buildSapiensHistoryContext({
          products: user.products,
          excludeReviewKey: reviewKey,
          targetCategory: product?.category ?? "",
        })
      : buildHistoryBaselineContext({
          products: user.products,
          excludeReviewKey: reviewKey,
        });

  return NextResponse.json({ items, count: items.length });
}
