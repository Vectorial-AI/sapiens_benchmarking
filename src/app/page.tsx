"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Dot, Label, Spinner, Stars, TONE_BG, type Tone } from "@/components/ui";
import {
  BASELINE_METHOD_META,
  BASELINE_METHODS,
  BASELINE_MODELS,
  baselineLabel,
  SAPIENS_MODEL,
  type BaselineMethod,
  type BaselineModel,
} from "@/lib/baselines";
import type {
  CatalogTribe,
  CatalogTribeIndex,
  HistoryContextItem,
  PipelineMetrics,
  ReviewSentiment,
  RunResponse,
} from "@/lib/types";

const STEPS = [
  {
    id: "tribe",
    label: "Tribe",
    title: "Pick a learned tribe",
    hint: "30 Sapiens-discovered behavioral tribes. Select one to inspect its evolved traits.",
  },
  {
    id: "user",
    label: "User",
    title: "Pick a modelled user",
    hint: "Users ranked by modelling similarity score (best performers first).",
  },
  {
    id: "product",
    label: "Product",
    title: "Pick a product",
    hint: "Choose a product from this user's review history.",
  },
  {
    id: "baseline",
    label: "Baseline",
    title: "Select a baseline",
    hint: "15 baselines: 3 methods × 5 models. Sapiens runs on a fixed model (gpt-5.2).",
  },
  {
    id: "compare",
    label: "Compare",
    title: "Baseline vs Sapiens",
    hint: "The selected baseline is compared against Sapiens using evolved tribe traits.",
  },
];

export default function Home() {
  const [step, setStep] = useState(0);
  const [gatewayConnected, setGatewayConnected] = useState(false);

  const [tribeIndex, setTribeIndex] = useState<CatalogTribeIndex[] | null>(null);
  const [tribeId, setTribeId] = useState("");
  const [tribe, setTribe] = useState<CatalogTribe | null>(null);
  const [tribeLoading, setTribeLoading] = useState(false);
  const [traitsOpen, setTraitsOpen] = useState(true);

  const [userId, setUserId] = useState("");
  const [reviewKey, setReviewKey] = useState<string | null>(null);

  const [baselineMethod, setBaselineMethod] = useState<BaselineMethod>("history");
  const [baselineModel, setBaselineModel] = useState<BaselineModel>("gpt-5.2");

  const [run, setRun] = useState<RunResponse | null>(null);
  const [running, setRunning] = useState(false);

  const user = useMemo(
    () => tribe?.users.find((u) => u.id === userId) ?? null,
    [tribe, userId],
  );
  const product = useMemo(
    () => user?.products.find((p) => p.reviewKey === reviewKey) ?? null,
    [user, reviewKey],
  );

  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => r.json())
      .then((d) => setTribeIndex(d.tribes ?? []))
      .catch(() => {});
  }, []);

  async function loadTribe(id: string) {
    setTribeLoading(true);
    setTribe(null);
    try {
      const res = await fetch(`/api/tribe/${id}`);
      const data = await res.json();
      const t: CatalogTribe = data.tribe;
      setTribe(t);
      setTribeId(id);
      const firstUser = t.users[0];
      setUserId(firstUser?.id ?? "");
      setReviewKey(firstUser?.products[0]?.reviewKey ?? null);
      resetOutputs();
    } finally {
      setTribeLoading(false);
    }
  }

  function selectUser(id: string) {
    const u = tribe?.users.find((x) => x.id === id);
    setUserId(id);
    setReviewKey(u?.products[0]?.reviewKey ?? null);
    resetOutputs();
  }

  function selectProduct(key: string) {
    setReviewKey(key);
    resetOutputs();
  }

  function resetOutputs() {
    setRun(null);
  }

  const canRun = Boolean(tribeId && userId && product?.productDescription?.trim());

  async function doRun() {
    if (!canRun) return;
    setRunning(true);
    setRun(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tribeId,
          userId,
          reviewKey: reviewKey ?? undefined,
          baselineMethod,
          baselineModel,
        }),
      });
      const data: RunResponse = await res.json();
      setRun(data);
      setGatewayConnected(data.source === "gateway");
    } catch {
      /* noop */
    } finally {
      setRunning(false);
    }
  }

  function goTo(target: number) {
    const t = Math.max(0, Math.min(STEPS.length - 1, target));
    setStep(t);
    if (t === 4 && !run && !running && canRun) void doRun();
  }

  const benchmarkHref = `/benchmark?tribeId=${encodeURIComponent(tribeId)}`;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:py-12">
      <Header connected={gatewayConnected} />

      <Stepper step={step} onStep={goTo} />

      <div className="mt-8 mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight">{STEPS[step].title}</h1>
        <p className="text-[14px] text-muted mt-1">{STEPS[step].hint}</p>
      </div>

      <section className="card p-6 sm:p-7 animate-in" key={step}>
        {!tribeIndex ? (
          <LoadingBlock />
        ) : (
          <>
            {step === 0 && (
              <div className="space-y-4">
                <p className="text-[13px] text-muted">
                  {tribeIndex.length} tribes available · traits from SGO evolution or seed summaries
                </p>
                <div className="grid gap-2 sm:grid-cols-2 max-h-[28rem] overflow-y-auto pr-1">
                  {tribeIndex.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => void loadTribe(t.id)}
                      className={`text-left rounded-xl border p-3.5 transition ${
                        tribeId === t.id
                          ? "border-accent bg-accent/[0.04]"
                          : "border-border hover:border-border-strong"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Dot tone="sapiens" />
                        <span className="text-[13px] font-semibold leading-snug">{t.name}</span>
                      </div>
                      <p className="text-[11px] text-muted-2 mb-1.5">
                        {t.cluster} · {t.microId} · {t.userCount} users
                      </p>
                      <p className="text-[12px] text-muted line-clamp-2">{t.description}</p>
                      <p className="text-[10px] text-muted-2 mt-1.5">
                        Traits: {t.traitCounts.behavioral} behavioral · {t.traitSource}
                      </p>
                    </button>
                  ))}
                </div>

                {tribeLoading && (
                  <div className="flex items-center gap-2 text-[13px] text-muted">
                    <Spinner /> Loading tribe traits…
                  </div>
                )}

                {tribe && !tribeLoading && (
                  <LearnedTribePanel
                    tribe={tribe}
                    open={traitsOpen}
                    onToggle={() => setTraitsOpen((v) => !v)}
                  />
                )}
              </div>
            )}

            {step === 1 && tribe && (
              <div className="space-y-3">
                <StepContextHeader
                  tribeName={tribe.name}
                  subtitle={`${tribe.cluster} · ${tribe.microId} · ${tribe.users.length} modelled users`}
                />
                {tribe.dataSources && (
                  <DataSourceNote
                    users={tribe.dataSources.users}
                    similarity={tribe.dataSources.similarity}
                  />
                )}
                <div className="space-y-2 max-h-[24rem] overflow-y-auto pr-1">
                {tribe.users.map((u, i) => (
                  <button
                    key={u.id}
                    onClick={() => selectUser(u.id)}
                    className={`w-full text-left rounded-xl border p-3.5 transition ${
                      u.id === userId
                        ? "border-accent bg-accent/[0.04]"
                        : "border-border hover:border-border-strong"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-mono text-muted-2">#{i + 1}</span>
                      <span className="text-[12.5px] font-medium text-foreground">
                        Modelled user
                      </span>
                      <span className="text-[11px] font-semibold text-accent ml-auto">
                        {(u.similarityScore * 100).toFixed(1)}% sim
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-muted-2 mb-1">{u.id.slice(0, 18)}…</p>
                    <p className="text-[12.5px] text-muted leading-relaxed line-clamp-2">
                      {u.characteristicSummary}
                    </p>
                    <p className="text-[11px] text-muted-2 mt-1">{u.products.length} products</p>
                  </button>
                ))}
                </div>
              </div>
            )}

            {step === 2 && user && tribe && (
              <div className="space-y-4">
                <StepContextHeader
                  tribeName={tribe.name}
                  subtitle={`Modelled user · ${user.id.slice(0, 20)}… · ${user.products.length} products`}
                />
                {tribe.dataSources && (
                  <DataSourceNote products={tribe.dataSources.products} />
                )}
                <div className="space-y-2 max-h-[22rem] overflow-y-auto pr-1">
                  {user.products.map((p) => (
                    <button
                      key={p.reviewKey}
                      onClick={() => selectProduct(p.reviewKey)}
                      className={`w-full text-left rounded-xl border p-3.5 transition ${
                        p.reviewKey === reviewKey
                          ? "border-accent bg-accent/[0.04]"
                          : "border-border hover:border-border-strong"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[13px] text-foreground leading-snug line-clamp-2">
                          {p.productDescription}
                        </p>
                        {p.rating != null && (
                          <span className="shrink-0">
                            <Stars rating={p.rating} />
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-2 mt-1.5">{p.category}</p>
                    </button>
                  ))}
                </div>
                <p className="text-[12.5px] text-muted-2 leading-relaxed flex items-start gap-1.5">
                  <span className="text-history">●</span>
                  The real review is ground truth and is excluded from the history baseline
                  (leave-one-out).
                </p>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <div>
                  <Label>Baseline method</Label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {BASELINE_METHODS.map((m) => (
                      <button
                        key={m}
                        onClick={() => {
                          setBaselineMethod(m);
                          resetOutputs();
                        }}
                        className={`text-left rounded-xl border p-3 transition ${
                          baselineMethod === m
                            ? "border-accent bg-accent/[0.04]"
                            : "border-border hover:border-border-strong"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Dot tone={BASELINE_METHOD_META[m].tone} />
                          <span className="text-[13px] font-medium">
                            {BASELINE_METHOD_META[m].label}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-2 leading-relaxed">
                          {BASELINE_METHOD_META[m].blurb}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label>Model (baseline only)</Label>
                  <div className="flex flex-wrap gap-2">
                    {BASELINE_MODELS.map((m) => (
                      <button
                        key={m}
                        onClick={() => {
                          setBaselineModel(m);
                          resetOutputs();
                        }}
                        className={`chip ${baselineModel === m ? "border-accent text-accent" : ""}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="card-soft p-3 text-[12px] text-muted">
                  <span className="font-medium text-foreground">Sapiens model (fixed):</span>{" "}
                  {SAPIENS_MODEL} — from amazon_sgo_pipeline_config.yaml
                </div>
              </div>
            )}

            {step === 4 && (
              <div>
                <div className="flex flex-wrap items-center gap-3 mb-5">
                  {running && (
                    <span className="text-[13px] text-muted flex items-center gap-1.5">
                      <Spinner /> Running {baselineLabel(baselineMethod, baselineModel)} vs Sapiens…
                    </span>
                  )}
                  {run?.metricsSource && !running && (
                    <span className="text-[11px] text-muted-2">
                      Scored with pipeline metrics
                      {run.metricsSource === "mock" ? " (lexical text fallback)" : ""}
                    </span>
                  )}
                  {run && (
                    <Link
                      href={benchmarkHref}
                      className="btn btn-ghost px-4 py-1.5 text-[13px] ml-auto text-accent"
                    >
                      View benchmark metrics →
                    </Link>
                  )}
                </div>

                {run?.historyContext && run.historyContext.length > 0 && (
                  <HistoryContextPanel
                    items={run.historyContext}
                    excludedKey={reviewKey}
                  />
                )}

                <div className="grid gap-4 sm:grid-cols-2 mt-4">
                  <ResultCard
                    tone="real"
                    title="Real review"
                    subtitle="ground truth"
                    text={run?.groundTruth ?? undefined}
                  />
                  <ResultCard
                    tone={BASELINE_METHOD_META[baselineMethod].tone}
                    title={baselineLabel(baselineMethod, baselineModel)}
                    subtitle={BASELINE_METHOD_META[baselineMethod].blurb}
                    loading={running}
                    text={run?.results.baseline?.reviewText}
                    predictedThemes={run?.results.baseline?.predictedThemes}
                    sentiment={run?.results.baseline?.sentiment}
                    metrics={run?.results.baseline?.metrics}
                    error={run?.results.baseline?.error}
                    latencyMs={run?.results.baseline?.latencyMs}
                  />
                  <ResultCard
                    tone="sapiens"
                    title="Sapiens"
                    subtitle={`Evolved tribe traits · ${SAPIENS_MODEL}`}
                    loading={running}
                    text={run?.results.sapiens?.reviewText}
                    predictedThemes={run?.results.sapiens?.predictedThemes}
                    sentiment={run?.results.sapiens?.sentiment}
                    metrics={run?.results.sapiens?.metrics}
                    error={run?.results.sapiens?.error}
                    latencyMs={run?.results.sapiens?.latencyMs}
                  />
                </div>

                {run?.results.baseline?.metrics && run?.results.sapiens?.metrics && (
                  <p className="text-[13px] text-muted mt-5 pt-5 border-t border-border leading-relaxed">
                    <span className="text-foreground font-medium">Overall.</span>{" "}
                    {run.results.sapiens.metrics.overallSimilarityScore !== null &&
                    run.results.baseline.metrics.overallSimilarityScore !== null ? (
                      run.results.sapiens.metrics.overallSimilarityScore >=
                      run.results.baseline.metrics.overallSimilarityScore ? (
                        <>
                          Sapiens scores higher on the pipeline composite (
                          {fmtPct(run.results.sapiens.metrics.overallSimilarityScore)} vs{" "}
                          {fmtPct(run.results.baseline.metrics.overallSimilarityScore)}).
                        </>
                      ) : (
                        <>
                          {baselineLabel(baselineMethod, baselineModel)} scores higher on the pipeline
                          composite ({fmtPct(run.results.baseline.metrics.overallSimilarityScore)} vs{" "}
                          {fmtPct(run.results.sapiens.metrics.overallSimilarityScore)}).
                        </>
                      )
                    ) : (
                      "Composite scores computed where ground truth is available."
                    )}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <div className="flex items-center justify-between mt-6">
        <button
          onClick={() => goTo(step - 1)}
          disabled={step === 0}
          className="btn btn-ghost px-4 py-2 text-sm disabled:opacity-0"
        >
          Back
        </button>
        {step < STEPS.length - 1 && (
          <button
            onClick={() => goTo(step + 1)}
            disabled={
              (step === 0 && !tribe) ||
              (step === 1 && !userId) ||
              (step === 2 && !canRun) ||
              (step === 3 && !canRun)
            }
            className="btn btn-primary px-6 py-2 text-sm"
          >
            {step === 3 ? "Run comparison" : "Continue"}
          </button>
        )}
      </div>

      <footer className="text-center text-xs text-muted-2 mt-12">
        Sapiens Benchmark ·{" "}
        <a href="https://runvectorial.com" className="hover:text-muted transition" target="_blank" rel="noreferrer">
          Vectorial
        </a>
      </footer>
    </div>
  );
}

function Header({ connected }: { connected: boolean }) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Image src="/vectorial-logo.png" alt="Vectorial" width={163} height={22} className="h-[22px] w-auto" priority />
        <span className="h-4 w-px bg-border-strong" />
        <span className="text-[13px] text-muted">Sapiens Benchmark</span>
      </div>
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-real" : "bg-accent"}`} />
        {connected ? "Gateway" : "Mock / Gateway"}
      </span>
    </header>
  );
}

function Stepper({ step, onStep }: { step: number; onStep: (n: number) => void }) {
  return (
    <nav className="flex items-center mt-9 overflow-x-auto">
      {STEPS.map((s, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={s.id} className="flex items-center flex-1 last:flex-none min-w-0">
            <button onClick={() => onStep(i)} className="flex items-center gap-2 group shrink-0">
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold transition ${
                  active ? "bg-accent text-white" : done ? "bg-accent/15 text-accent" : "bg-surface-3 text-muted-2"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={`text-[12px] font-medium hidden md:inline ${active ? "text-foreground" : "text-muted-2"}`}>
                {s.label}
              </span>
            </button>
            {i < STEPS.length - 1 && <span className={`h-px flex-1 mx-2 min-w-[12px] ${done ? "bg-accent/30" : "bg-border"}`} />}
          </div>
        );
      })}
    </nav>
  );
}

function StepContextHeader({
  tribeName,
  subtitle,
}: {
  tribeName: string;
  subtitle: string;
}) {
  return (
    <div className="card-soft px-4 py-3">
      <div className="flex items-center gap-2 text-[14px]">
        <Dot tone="sapiens" />
        <span className="font-semibold">{tribeName}</span>
      </div>
      <p className="text-[12px] text-muted-2 mt-1 ml-4">{subtitle}</p>
    </div>
  );
}

function DataSourceNote({
  users,
  products,
  similarity,
}: {
  users?: string;
  products?: string;
  similarity?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/50 px-3.5 py-2.5 text-[11px] text-muted-2 leading-relaxed space-y-0.5">
      <p className="font-medium text-muted uppercase tracking-wide text-[10px] mb-1">
        Data sources
      </p>
      {users && <p><span className="text-foreground/70">Users:</span> {users}</p>}
      {similarity && <p><span className="text-foreground/70">Similarity rank:</span> {similarity}</p>}
      {products && <p><span className="text-foreground/70">Products:</span> {products}</p>}
    </div>
  );
}

function LearnedTribePanel({
  tribe,
  open,
  onToggle,
}: {
  tribe: CatalogTribe;
  open: boolean;
  onToggle: () => void;
}) {
  const q = tribe.qualitative;
  const groups: { key: keyof typeof q; label: string; items: string[] }[] = [
    { key: "inherentBehavioralTraits", label: "Inherent behavioral traits", items: q.inherentBehavioralTraits },
    { key: "latentMotivations", label: "Latent motivations", items: q.latentMotivations },
    { key: "validationTriggers", label: "Validation triggers", items: q.validationTriggers },
    { key: "frictionPoints", label: "Friction points", items: q.frictionPoints },
    { key: "implicitGoals", label: "Implicit goals", items: q.implicitGoals },
  ];

  return (
    <div className="card-soft p-4 mt-2">
      <button onClick={onToggle} className="flex items-center gap-1.5 text-[13px] font-medium w-full text-left">
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        Learned tribe from Sapiens
        <span className="text-muted-2 font-normal">· {tribe.traitSource}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-4 max-h-[24rem] overflow-y-auto">
          <p className="text-[12.5px] text-muted leading-relaxed">{tribe.description}</p>
          {groups.map((g) => (
            <TraitGroup key={g.key} label={g.label} items={g.items} />
          ))}
        </div>
      )}
    </div>
  );
}

function TraitGroup({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-2 mb-1.5">
        {label} ({items.length})
      </p>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="text-[12.5px] text-muted leading-relaxed flex gap-2">
            <span className="text-accent-soft mt-0.5 shrink-0">•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HistoryContextPanel({
  items,
  excludedKey,
}: {
  items: HistoryContextItem[];
  excludedKey?: string | null;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-history/30 bg-history/[0.03] p-4 mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-[13px] font-medium text-history w-full text-left"
      >
        <Dot tone="history" />
        History context sent to baseline ({items.length} reviews, leave-one-out)
        <span className="ml-auto text-muted-2">{open ? "▲" : "▼"}</span>
      </button>
      <p className="text-[11px] text-muted-2 mt-2 ml-4">
        All other reviews for this user are sent — held-out product
        {excludedKey ? ` (${excludedKey.slice(0, 24)}…)` : ""} is excluded.
      </p>
      {open && (
        <div className="mt-3 space-y-3 max-h-64 overflow-y-auto">
          {items.map((h, i) => (
            <div key={i} className="text-[12px] border-t border-border pt-2 first:border-0 first:pt-0">
              <p className="text-muted-2 font-medium mb-1">Example {i + 1}</p>
              <p className="text-foreground/80 whitespace-pre-wrap">{h.reviewText}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value * 100)}%`;
}

function ResultCard({
  tone,
  title,
  subtitle,
  text,
  predictedThemes,
  sentiment,
  metrics,
  loading,
  error,
  latencyMs,
}: {
  tone: Tone;
  title: string;
  subtitle?: string;
  text?: string;
  predictedThemes?: Record<string, number>;
  sentiment?: ReviewSentiment | null;
  metrics?: PipelineMetrics;
  loading?: boolean;
  error?: string;
  latencyMs?: number;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isGenerated = tone !== "real";
  const showSkeleton = loading && isGenerated && !text;
  const themeEntries = Object.entries(predictedThemes ?? {}).sort((a, b) => b[1] - a[1]);
  const hasStructuredOutput = isGenerated && (themeEntries.length > 0 || sentiment);
  return (
    <div className="rounded-xl border border-border p-4 flex flex-col">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <Dot tone={tone} />
          <span className="text-[13px] font-medium">{title}</span>
        </div>
        {latencyMs ? (
          <span className="text-[11px] text-muted-2">{(latencyMs / 1000).toFixed(1)}s</span>
        ) : null}
      </div>
      {subtitle && <p className="text-[11px] text-muted-2 -mt-1.5 mb-2.5">{subtitle}</p>}
      {metrics?.overallSimilarityScore !== null && metrics?.overallSimilarityScore !== undefined && (
        <div className="mb-2.5">
          <div className="flex items-center justify-between text-[11px] text-muted mb-1">
            <span>Overall similarity</span>
            <span className="font-medium text-foreground">
              {fmtPct(metrics.overallSimilarityScore)}
              {metrics.isMatch !== null && (
                <span className={`ml-1.5 ${metrics.isMatch ? "text-real" : "text-muted-2"}`}>
                  {metrics.isMatch ? "· match" : "· no match"}
                </span>
              )}
            </span>
          </div>
          <div className="h-1 rounded-full bg-surface-3 overflow-hidden">
            <div
              className={`h-full rounded-full ${TONE_BG[tone]}`}
              style={{
                width: `${Math.min(100, Math.max(0, metrics.overallSimilarityScore * 100))}%`,
              }}
            />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10px] text-muted-2">
            {metrics.recallAtK !== null && <span>recall@k {fmtPct(metrics.recallAtK)}</span>}
            {metrics.textSimilarity !== null && (
              <span>text {fmtPct(metrics.textSimilarity)}</span>
            )}
            {metrics.sentimentMatch !== null && (
              <span>sentiment {metrics.sentimentMatch === 1 ? "✓" : "✗"}</span>
            )}
          </div>
        </div>
      )}
      {showSkeleton ? (
        <div className="space-y-2 mt-1">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="shimmer h-3 rounded" style={{ width: `${96 - i * 18}%` }} />
          ))}
        </div>
      ) : error ? (
        <p className="text-[12.5px] text-red-500/90">{error}</p>
      ) : text ? (
        <p className="prose-review text-[13px] text-foreground/90 flex-1 whitespace-pre-wrap">
          {text.replace(/<br\s*\/?>/gi, "\n")}
        </p>
      ) : (
        <p className="text-[12.5px] text-muted-2">{loading ? "Generating…" : "No review yet."}</p>
      )}
      {hasStructuredOutput && text && (
        <div className="mt-3 pt-3 border-t border-border">
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] text-muted-2 hover:text-muted transition w-full text-left"
          >
            <span className={`transition-transform text-[10px] ${detailsOpen ? "rotate-90" : ""}`}>▶</span>
            Structured model output
            <span className="text-muted-2/80">(themes & sentiment)</span>
          </button>
          {detailsOpen && (
            <div className="mt-2 space-y-2">
              {sentiment && (
                <p className="text-[11px] text-muted">
                  <span className="text-muted-2">Sentiment:</span>{" "}
                  <span className="text-foreground/80">{sentiment}</span>
                </p>
              )}
              {themeEntries.length > 0 && (
                <ul className="space-y-1">
                  {themeEntries.map(([theme, value]) => (
                    <li key={theme} className="flex items-center gap-2 text-[11px]">
                      <span className="text-muted truncate flex-1" title={theme}>
                        {theme}
                      </span>
                      <span className="text-muted-2 tabular-nums w-8 text-right">{value.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="shimmer h-4 rounded" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}
