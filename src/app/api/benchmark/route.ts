import path from "path";
import { NextResponse } from "next/server";
import benchmarkMetrics from "@/data/benchmark-metrics.json";

export const runtime = "nodejs";

type RawMode = {
  mode: string;
  pipeline: string;
  nReviews: number;
  textSimilarity: number | null;
  recallAtK: number | null;
  sentiment: number | null;
  overallSimilarity: number | null;
  matchCount: number | null;
  matchPct: number | null;
};

/** Aggregated benchmark metrics — bundled in src/data for Vercel deployment. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tribeId = searchParams.get("tribeId") ?? "cluster_4-micro_7";

  const raw = benchmarkMetrics as {
    cluster?: string;
    micro?: string;
    canonicalReviews?: number;
    matchThreshold?: number;
    source?: string;
    modes: RawMode[];
  };

  const modes = raw.modes ?? [];
  const sapiensMode = modes.find((m) => m.mode === "sapiens") ?? null;
  const baselineModes = modes.filter((m) => m.mode !== "sapiens");

  return NextResponse.json({
    tribeId,
    cluster: raw.cluster,
    micro: raw.micro,
    available: modes.length > 0,
    canonicalReviews: raw.canonicalReviews,
    matchThreshold: raw.matchThreshold ?? 0.65,
    dataSource: raw.source,
    sapiensMode,
    baselineModes,
    allModes: modes,
    source: path.join("src", "data", "benchmark-metrics.json"),
  });
}
