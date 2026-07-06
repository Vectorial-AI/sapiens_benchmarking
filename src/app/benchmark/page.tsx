"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Dot, Spinner } from "@/components/ui";

type ModeSummary = {
  mode: string;
  pipeline: string;
  nReviews: number;
  recallAtK: number | null;
  textSimilarity: number | null;
  overallSimilarity: number | null;
  jsd: number | null;
};

type BenchmarkData = {
  tribeId: string;
  cluster?: string;
  micro?: string;
  available: boolean;
  canonicalReviews?: number;
  sapiensModes: ModeSummary[];
  baselineModes: ModeSummary[];
  allModes: ModeSummary[];
  message?: string;
};

function BenchmarkContent() {
  const searchParams = useSearchParams();
  const tribeId = searchParams.get("tribeId") ?? "cluster_4-micro_7";
  const [data, setData] = useState<BenchmarkData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/benchmark?tribeId=${encodeURIComponent(tribeId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tribeId]);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8 sm:py-12">
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Image src="/vectorial-logo.png" alt="Vectorial" width={163} height={22} className="h-[22px] w-auto" />
          <span className="h-4 w-px bg-border-strong" />
          <span className="text-[13px] text-muted">Benchmark Metrics</span>
        </div>
        <Link href="/" className="btn btn-ghost px-4 py-2 text-sm">
          ← Back to benchmark
        </Link>
      </header>

      <h1 className="text-[22px] font-semibold tracking-tight mb-1">
        Aggregated scores: Sapiens vs baselines
      </h1>
      <p className="text-[14px] text-muted mb-6">
        Reference run from bundled{" "}
        <code className="text-[12px] bg-surface-3 px-1.5 py-0.5 rounded">
          src/data/benchmark-metrics.json
        </code>
        {data?.canonicalReviews && ` · ${data.canonicalReviews} reviews`}
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-muted">
          <Spinner /> Loading metrics…
        </div>
      ) : !data?.available ? (
        <p className="text-muted">{data?.message ?? "Metrics not available."}</p>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="text-[15px] font-semibold mb-3 flex items-center gap-2">
              <Dot tone="sapiens" /> Sapiens pipeline modes
            </h2>
            <MetricsTable modes={data.sapiensModes} highlight />
          </section>

          <section>
            <h2 className="text-[15px] font-semibold mb-3 flex items-center gap-2">
              <Dot tone="persona" /> Baseline modes (history · tribe · population)
            </h2>
            <MetricsTable modes={data.baselineModes} />
          </section>

          <section>
            <h2 className="text-[15px] font-semibold mb-3">All modes</h2>
            <MetricsTable modes={data.allModes} compact />
          </section>
        </div>
      )}
    </div>
  );
}

function MetricsTable({
  modes,
  highlight,
  compact,
}: {
  modes: ModeSummary[];
  highlight?: boolean;
  compact?: boolean;
}) {
  if (!modes.length) return <p className="text-[13px] text-muted-2">No modes in this group.</p>;

  const fmt = (v: number | null) => (v != null ? (v * 100).toFixed(1) + "%" : "—");

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border bg-surface-2 text-left text-muted-2">
            <th className="px-4 py-2.5 font-medium">Mode</th>
            {!compact && <th className="px-4 py-2.5 font-medium">Pipeline</th>}
            <th className="px-4 py-2.5 font-medium">Reviews</th>
            <th className="px-4 py-2.5 font-medium">Recall@k</th>
            <th className="px-4 py-2.5 font-medium">Text sim</th>
            <th className="px-4 py-2.5 font-medium">Overall sim</th>
            {!compact && <th className="px-4 py-2.5 font-medium">JSD</th>}
          </tr>
        </thead>
        <tbody>
          {modes.map((m) => (
            <tr
              key={m.mode}
              className={`border-b border-border last:border-0 ${
                highlight ? "bg-accent/[0.03]" : ""
              }`}
            >
              <td className="px-4 py-2.5 font-mono text-[12px]">{m.mode}</td>
              {!compact && <td className="px-4 py-2.5 text-muted">{m.pipeline}</td>}
              <td className="px-4 py-2.5">{m.nReviews}</td>
              <td className="px-4 py-2.5">{fmt(m.recallAtK)}</td>
              <td className="px-4 py-2.5">{fmt(m.textSimilarity)}</td>
              <td className="px-4 py-2.5 font-medium">{fmt(m.overallSimilarity)}</td>
              {!compact && <td className="px-4 py-2.5">{m.jsd?.toFixed(3) ?? "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BenchmarkPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted">Loading…</div>}>
      <BenchmarkContent />
    </Suspense>
  );
}
