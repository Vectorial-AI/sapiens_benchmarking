import { NextResponse } from "next/server";
import { gateway } from "ai";
import { hasGatewayKey } from "@/lib/ai";

export const runtime = "nodejs";

const FALLBACK_MODELS = [
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "anthropic/claude-3-5-sonnet",
  "anthropic/claude-3-5-haiku",
  "google/gemini-2.0-flash",
  "meta/llama-3.3-70b",
];

export async function GET() {
  if (!hasGatewayKey()) {
    return NextResponse.json({ models: FALLBACK_MODELS, source: "fallback" });
  }
  try {
    const available = await gateway.getAvailableModels();
    const ids = available.models
      .map((m) => m.id)
      .filter((id) => /gpt|claude|gemini|llama|mistral|grok|deepseek/i.test(id))
      .sort();
    return NextResponse.json({
      models: ids.length ? ids : FALLBACK_MODELS,
      source: ids.length ? "gateway" : "fallback",
    });
  } catch {
    return NextResponse.json({ models: FALLBACK_MODELS, source: "fallback" });
  }
}
