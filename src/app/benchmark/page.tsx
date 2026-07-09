"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Dot, Spinner } from "@/components/ui";
import { markWizardRestorePending } from "@/lib/wizard-session";

type ModeSummary = {
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

type BenchmarkData = {
  tribeId: string;
  cluster?: string;
  micro?: string;
  available: boolean;
  canonicalReviews?: number;
  matchThreshold?: number;
  dataSource?: string;
  sapiensMode: ModeSummary | null;
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

  const threshold = data?.matchThreshold ?? 0.75;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8 sm:py-12">
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Image src="/vectorial-logo.png" alt="Vectorial" width={163} height={22} className="h-[22px] w-auto" />
          <span className="h-4 w-px bg-border-strong" />
          <span className="text-[13px] text-muted">Benchmark Metrics</span>
        </div>
        <Link
          href="/"
          onClick={() => markWizardRestorePending()}
          className="btn btn-ghost px-4 py-2 text-sm"
        >
          ← Back
        </Link>
      </header>

      <h1 className="text-[22px] font-semibold tracking-tight mb-1">
        Aggregated scores: SAPIENS vs baselines
      </h1>
      <p className="text-[14px] text-muted mb-2">
        Mean metrics over {data?.canonicalReviews ?? 252} canonical reviews · match threshold{" "}
        {Math.round(threshold * 100)}%
      </p>
      <p className="text-[12px] text-muted-2 mb-6">
        Overall = 0.25×text + 0.70×recall@k + 0.05×sentiment
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-muted">
          <Spinner /> Loading metrics…
        </div>
      ) : !data?.available ? (
        <p className="text-muted">{data?.message ?? "Metrics not available."}</p>
      ) : (
        <div className="space-y-8">
          {data.sapiensMode && (
            <section>
              <h2 className="text-[15px] font-semibold mb-3 flex items-center gap-2">
                <Dot tone="sapiens" /> SAPIENS
              </h2>
              <MetricsTable modes={[data.sapiensMode]} highlight threshold={threshold} />
            </section>
          )}

          <section>
            <h2 className="text-[15px] font-semibold mb-3 flex items-center gap-2">
              <Dot tone="persona" /> Baselines (history · tribe · population)
            </h2>
            <MetricsTable modes={data.baselineModes} threshold={threshold} />
          </section>

          <section>
            <h2 className="text-[15px] font-semibold mb-3">All modes (ranked)</h2>
            <MetricsTable modes={data.allModes} threshold={threshold} />
          </section>
        </div>
      )}
    </div>
  );
}

function MetricsTable({
  modes,
  highlight,
  threshold,
}: {
  modes: ModeSummary[];
  highlight?: boolean;
  threshold: number;
}) {
  if (!modes.length) return <p className="text-[13px] text-muted-2">No modes in this group.</p>;

  const fmtRaw = (v: number | null) => (v != null ? v.toFixed(4) : "—");

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border bg-surface-2 text-left text-muted-2">
            <th className="px-4 py-2.5 font-medium">Mode</th>
            <th className="px-4 py-2.5 font-medium">Mean text sim</th>
            <th className="px-4 py-2.5 font-medium">Mean recall@k</th>
            <th className="px-4 py-2.5 font-medium">Mean sentiment</th>
            <th className="px-4 py-2.5 font-medium">Mean overall</th>
            <th className="px-4 py-2.5 font-medium">Reviews ≥ {threshold}</th>
            <th className="px-4 py-2.5 font-medium">Reviews ≥ {threshold} (%)</th>
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
              <td className="px-4 py-2.5">{fmtRaw(m.textSimilarity)}</td>
              <td className="px-4 py-2.5">{fmtRaw(m.recallAtK)}</td>
              <td className="px-4 py-2.5">{fmtRaw(m.sentiment)}</td>
              <td className="px-4 py-2.5 font-medium">{fmtRaw(m.overallSimilarity)}</td>
              <td className="px-4 py-2.5">{m.matchCount ?? "—"}</td>
              <td className="px-4 py-2.5">{m.matchPct != null ? `${m.matchPct}%` : "—"}</td>
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
