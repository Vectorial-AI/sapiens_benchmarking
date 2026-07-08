import { NextResponse } from "next/server";
import { getSapiensBaselineExplanation } from "@/lib/explanations";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const reviewKey = new URL(req.url).searchParams.get("reviewKey")?.trim();
  if (!reviewKey) {
    return NextResponse.json({ error: "reviewKey is required" }, { status: 400 });
  }

  const explanation = getSapiensBaselineExplanation(reviewKey);
  if (!explanation) {
    return NextResponse.json({ error: "No explanation for this review" }, { status: 404 });
  }

  return NextResponse.json(explanation);
}
