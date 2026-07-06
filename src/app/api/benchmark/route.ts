import path from "path";
import { NextResponse } from "next/server";
import benchmarkMetrics from "@/data/benchmark-metrics.json";

export const runtime = "nodejs";

/** Aggregated benchmark metrics — bundled in src/data for Vercel deployment. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tribeId = searchParams.get("tribeId") ?? "cluster_4-micro_7";

  const raw = benchmarkMetrics as {
    cluster?: string;
    micro?: string;
    canonicalReviews?: number;
    modes: {
      mode: string;
      pipeline: string;
      nReviews: number;
      recallAtK: number | null;
      textSimilarity: number | null;
      overallSimilarity: number | null;
      jsd: number | null;
    }[];
  };

  const summary = raw.modes ?? [];
  const sapiensModes = summary.filter(
    (s) => s.pipeline === "sapiens" || s.mode.includes("sgo") || s.mode === "sapiens",
  );
  const baselineModes = summary.filter(
    (s) => s.pipeline !== "sapiens" && !s.mode.includes("sgo"),
  );

  return NextResponse.json({
    tribeId,
    cluster: raw.cluster,
    micro: raw.micro,
    available: true,
    canonicalReviews: raw.canonicalReviews,
    sapiensModes,
    baselineModes,
    allModes: summary,
    source: path.join("src", "data", "benchmark-metrics.json"),
  });
}
