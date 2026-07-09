import { NextResponse } from "next/server";
import { hasGatewayKey, runModel } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

const LABELS: Record<string, string> = {
  baseline: "Selected baseline",
  sapiens: "SAPIENS",
};

function overlap(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const wb = new Set(b.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  if (!wa.size || !wb.size) return 0;
  let hits = 0;
  wa.forEach((w) => wb.has(w) && hits++);
  return Math.round((hits / wa.size) * 100);
}

function parseJson<T>(text: string): T | null {
  try {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s === -1 || e === -1) return null;
    return JSON.parse(text.slice(s, e + 1)) as T;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const { real, candidates } = (await req.json()) as {
    real: string;
    candidates: Partial<Record<string, string>>;
  };

  if (!real?.trim()) {
    return NextResponse.json(
      { error: "A real (ground-truth) review is required to score against" },
      { status: 400 },
    );
  }

  const keys = Object.keys(candidates);

  const heuristic = () => {
    const scores = Object.fromEntries(
      keys.map((k) => [k, overlap(real, candidates[k] ?? "")]),
    ) as Record<string, number>;
    const winner = keys.reduce((a, b) => (scores[b] > scores[a] ? b : a), keys[0]);
    return {
      scores,
      verdict: `${LABELS[winner] ?? winner} shares the most vocabulary with the real review (lexical heuristic).`,
      source: "heuristic",
    };
  };

  if (!hasGatewayKey()) {
    return NextResponse.json(heuristic());
  }

  try {
    const system =
      "You are an impartial judge for a behavioral-modeling benchmark. Compare AI-generated reviews against a REAL human review and score 0-100 how faithfully each captures the real reviewer's priorities, specific points, tone and voice. Output only JSON.";
    const list = keys
      .map((k) => `### ${k} (${LABELS[k] ?? k})\n${candidates[k] ?? "(none)"}`)
      .join("\n\n");
    const prompt = `REAL HUMAN REVIEW:
${real}

CANDIDATES:
${list}

Return JSON exactly:
{
  "scores": { ${keys.map((k) => `"${k}": <0-100>`).join(", ")} },
  "verdict": "one sentence naming the closest to the real review and why"
}`;
    const raw = await runModel({ model: "openai/gpt-4o", system, prompt, temperature: 0.2 });
    const parsed = parseJson<{
      scores: Record<string, number>;
      verdict: string;
    }>(raw);
    if (!parsed?.scores) return NextResponse.json(heuristic());
    return NextResponse.json({ ...parsed, source: "judge" });
  } catch {
    return NextResponse.json(heuristic());
  }
}
