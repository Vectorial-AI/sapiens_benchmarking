import { NextResponse } from "next/server";
import { findContext } from "@/lib/master";
import { buildUserHistoryContext } from "@/lib/prompts";

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

  const targetCategory = categoryParam || product?.category || "";
  const items = buildUserHistoryContext(user);

  return NextResponse.json({
    items,
    count: items.length,
    targetCategory,
    filter: "User history (review text only)",
  });
}
