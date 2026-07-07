"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dot, Label, Spinner, TONE_BG, type Tone } from "@/components/ui";
import {
  BASELINE_METHOD_META,
  BASELINE_METHODS,
  BASELINE_MODELS,
  baselineLabel,
  type BaselineMethod,
  type BaselineModel,
} from "@/lib/baselines";
import type {
  BaselineResult,
  BaselineRunResponse,
  CatalogTribe,
  CatalogTribeIndex,
  EngineResult,
  HistoryContextItem,
  PipelineMetrics,
  ReviewSentiment,
  SapiensRunResponse,
} from "@/lib/types";
import {
  clearWizardRestoreFlag,
  loadWizardSession,
  saveWizardSession,
} from "@/lib/wizard-session";

const STEPS = [
  { id: "tribe", label: "Tribe", title: "Pick a modelled tribe", hint: "Select a behavioral tribe to model." },
  { id: "user", label: "User", title: "Pick a modelled user", hint: "" },
  { id: "product", label: "Product", title: "Pick a product", hint: "Choose a product from this user." },
  { id: "sapiens", label: "Sapiens", title: "Sapiens prediction", hint: "What Sapiens generates vs the real review." },
  { id: "compare", label: "Compare", title: "Compare baselines", hint: "Run baselines and compare scores against Sapiens." },
];

function defaultReviewKeyForUser(user: CatalogTribe["users"][number] | null | undefined): string | null {
  if (!user?.products.length) return null;
  const benchmark = user.products.find((p) => p.healthcareBenchmark);
  return benchmark?.reviewKey ?? user.products[0]?.reviewKey ?? null;
}

export default function Home() {
  const router = useRouter();
  const restoredRef = useRef(false);
  const skipProductDescSyncRef = useRef(false);
  const skipPopulationDefSyncRef = useRef(false);
  const [step, setStep] = useState(0);
  const [gatewayConnected, setGatewayConnected] = useState(false);

  const [tribeIndex, setTribeIndex] = useState<CatalogTribeIndex[] | null>(null);
  const [tribeId, setTribeId] = useState("");
  const [tribe, setTribe] = useState<CatalogTribe | null>(null);
  const [tribeLoading, setTribeLoading] = useState(false);
  const [traitsOpen, setTraitsOpen] = useState(true);

  const [userId, setUserId] = useState("");
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const [customProductDesc, setCustomProductDesc] = useState("");

  const [baselineMethod, setBaselineMethod] = useState<BaselineMethod>("history");
  const [useCustomPopulationDef, setUseCustomPopulationDef] = useState(false);
  const [customPopulationDef, setCustomPopulationDef] = useState("");

  const [groundTruth, setGroundTruth] = useState<string | null>(null);
  const [groundTruthThemes, setGroundTruthThemes] = useState<string[]>([]);
  const [groundTruthSentiment, setGroundTruthSentiment] = useState<ReviewSentiment | null>(null);
  const [sapiens, setSapiens] = useState<EngineResult | null>(null);
  const [baselines, setBaselines] = useState<BaselineResult[]>([]);

  const [runningSapiens, setRunningSapiens] = useState(false);
  const [runningBaselineKey, setRunningBaselineKey] = useState<string | null>(null);
  const [runningBaselineMethod, setRunningBaselineMethod] = useState<BaselineMethod | null>(null);
  const [runningBaselineModel, setRunningBaselineModel] = useState<BaselineModel | null>(null);
  const [historyPreview, setHistoryPreview] = useState<HistoryContextItem[] | null>(null);
  const [historyPreviewLoading, setHistoryPreviewLoading] = useState(false);

  const user = useMemo(
    () => tribe?.users.find((u) => u.id === userId) ?? null,
    [tribe, userId],
  );
  const product = useMemo(
    () => user?.products.find((p) => p.reviewKey === reviewKey) ?? null,
    [user, reviewKey],
  );

  const effectiveProductDesc = customProductDesc.trim();
  const effectiveCategory = product?.category ?? "Health & Personal Care";
  const canRun = Boolean(tribeId && userId && effectiveProductDesc);

  useEffect(() => {
    if (skipProductDescSyncRef.current) {
      skipProductDescSyncRef.current = false;
      return;
    }
    if (product) setCustomProductDesc(product.productDescription);
  }, [product?.reviewKey, product?.productDescription]);

  useEffect(() => {
    if (skipPopulationDefSyncRef.current) {
      skipPopulationDefSyncRef.current = false;
      return;
    }
    if (tribe?.populationDefinition) {
      setCustomPopulationDef(tribe.populationDefinition);
    }
  }, [tribe?.id, tribe?.populationDefinition]);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => setGatewayConnected(Boolean(d.gatewayConfigured)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => r.json())
      .then((d) => setTribeIndex(d.tribes ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (restoredRef.current) return;
    const saved = loadWizardSession();
    if (!saved?.tribeId) return;
    restoredRef.current = true;
    clearWizardRestoreFlag();
    skipProductDescSyncRef.current = true;
    skipPopulationDefSyncRef.current = true;

    setStep(saved.step);
    setTribeId(saved.tribeId);
    setUserId(saved.userId);
    setReviewKey(saved.reviewKey);
    setCustomProductDesc(saved.customProductDesc);
    setBaselineMethod(saved.baselineMethod);
    setUseCustomPopulationDef(saved.useCustomPopulationDef);
    setCustomPopulationDef(saved.customPopulationDef);
    setGroundTruth(saved.groundTruth);
    setGroundTruthThemes(saved.groundTruthThemes);
    setGroundTruthSentiment(saved.groundTruthSentiment);
    setSapiens(saved.sapiens);
    setBaselines(saved.baselines);
    // gatewayConnected comes from /api/models on mount — don't restore stale session value

    setTribeLoading(true);
    fetch(`/api/tribe/${saved.tribeId}`)
      .then((r) => r.json())
      .then((d) => setTribe(d.tribe ?? null))
      .catch(() => {})
      .finally(() => setTribeLoading(false));
  }, []);

  useEffect(() => {
    if (step !== 4 || baselineMethod !== "history" || !canRun) {
      setHistoryPreview(null);
      return;
    }
    const params = new URLSearchParams({
      tribeId,
      userId,
      mode: "history",
      category: effectiveCategory,
    });
    if (reviewKey) params.set("reviewKey", reviewKey);
    setHistoryPreviewLoading(true);
    fetch(`/api/history-context?${params}`)
      .then((r) => r.json())
      .then((d) => setHistoryPreview((d.items as HistoryContextItem[]) ?? []))
      .catch(() => setHistoryPreview([]))
      .finally(() => setHistoryPreviewLoading(false));
  }, [step, baselineMethod, tribeId, userId, reviewKey, effectiveCategory, canRun]);

  function resetOutputs() {
    setSapiens(null);
    setBaselines([]);
    setGroundTruth(null);
    setGroundTruthThemes([]);
    setGroundTruthSentiment(null);
  }

  const gtThemeRecord = useMemo(
    () => Object.fromEntries(groundTruthThemes.map((t) => [t, 1])),
    [groundTruthThemes],
  );

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
      setReviewKey(defaultReviewKeyForUser(firstUser));
      resetOutputs();
    } finally {
      setTribeLoading(false);
    }
  }

  function selectUser(id: string) {
    const u = tribe?.users.find((x) => x.id === id);
    setUserId(id);
    setReviewKey(defaultReviewKeyForUser(u));
    resetOutputs();
  }

  function selectProduct(key: string) {
    setReviewKey(key);
    resetOutputs();
  }

  function runPayload() {
    return {
      tribeId,
      userId,
      reviewKey: reviewKey ?? undefined,
      productDescription: effectiveProductDesc,
      category: effectiveCategory,
    };
  }

  function baselineKey(method: BaselineMethod, model: BaselineModel) {
    const customPop =
      method === "population_persona" && useCustomPopulationDef && customPopulationDef.trim();
    return customPop ? `${method}:${model}:custom` : `${method}:${model}`;
  }

  async function doRunSapiens() {
    if (!canRun) return;
    setRunningSapiens(true);
    setSapiens(null);
    setBaselines([]);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...runPayload(),
          runMode: "sapiens",
        }),
      });
      const data: SapiensRunResponse = await res.json();
      setSapiens(data.sapiens ?? null);
      setGroundTruth(data.groundTruth ?? null);
      setGroundTruthThemes(data.groundTruthThemes ?? []);
      setGroundTruthSentiment(data.groundTruthSentiment ?? null);
      if (data.source === "gateway") setGatewayConnected(true);
    } catch {
      /* noop */
    } finally {
      setRunningSapiens(false);
    }
  }

  async function doRunBaseline(method: BaselineMethod, model: BaselineModel) {
    if (!canRun) return;
    if (method === "population_persona" && useCustomPopulationDef && !customPopulationDef.trim()) {
      return;
    }
    const key = baselineKey(method, model);
    if (baselines.some((b) => b.key === key) || runningBaselineKey === key) return;

    setRunningBaselineKey(key);
    setRunningBaselineMethod(method);
    setRunningBaselineModel(model);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...runPayload(),
          runMode: "baseline",
          baselineMethod: method,
          baselineModel: model,
          ...(method === "population_persona" && useCustomPopulationDef && customPopulationDef.trim()
            ? { populationDefinition: customPopulationDef.trim() }
            : {}),
        }),
      });
      const data: BaselineRunResponse = await res.json();
      if (data.baseline) {
        setBaselines((prev) => [...prev.filter((b) => b.key !== key), data.baseline]);
      }
    } catch {
      /* noop */
    } finally {
      setRunningBaselineKey(null);
      setRunningBaselineMethod(null);
      setRunningBaselineModel(null);
    }
  }

  function removeBaseline(key: string) {
    setBaselines((prev) => prev.filter((b) => b.key !== key));
  }

  function goTo(target: number) {
    const t = Math.max(0, Math.min(STEPS.length - 1, target));
    setStep(t);
    if (t === 3 && !sapiens && !runningSapiens && canRun) void doRunSapiens();
  }

  function openBenchmarking() {
    if (!tribeId) return;
    saveWizardSession({
      step,
      tribeId,
      userId,
      reviewKey,
      customProductDesc,
      baselineMethod,
      useCustomPopulationDef,
      customPopulationDef,
      groundTruth,
      groundTruthThemes,
      groundTruthSentiment,
      sapiens,
      baselines,
      gatewayConnected,
    });
    router.push(`/benchmark?tribeId=${encodeURIComponent(tribeId)}`);
  }

  function selectBaselineMethod(m: BaselineMethod) {
    setBaselineMethod(m);
    if (m !== "population_persona") setUseCustomPopulationDef(false);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:py-12">
      <Header connected={gatewayConnected} />

      <Stepper step={step} onStep={goTo} />

      <div className="mt-8 mb-6">
        {tribe && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <Dot tone="sapiens" />
              <span className="text-[13px] font-semibold text-foreground">{tribe.name}</span>
            </div>
            {tribe.tribeDefinition && (
              <p className="text-[12px] text-muted mt-2 ml-4 leading-relaxed">
                {tribe.tribeDefinition}
              </p>
            )}
          </div>
        )}
        <h1 className="text-[22px] font-semibold tracking-tight">{STEPS[step].title}</h1>
        {STEPS[step].hint ? (
          <p className="text-[14px] text-muted mt-1">{STEPS[step].hint}</p>
        ) : null}
      </div>

      <section className="card p-6 sm:p-7 animate-in" key={step}>
        {!tribeIndex ? (
          <LoadingBlock />
        ) : (
          <>
            {step === 0 && (
              <div className="space-y-4">
                {(["healthcare", "video_games"] as const).map((domain) => {
                  const domainTribes = tribeIndex.filter((t) => t.domain === domain);
                  if (domainTribes.length === 0) return null;
                  const label = domain === "healthcare" ? "Healthcare" : "Video Games";
                  return (
                    <div key={domain} className="space-y-2">
                      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted-2">
                        {label}
                      </h3>
                      <div className="grid gap-2 sm:grid-cols-2 max-h-[22rem] overflow-y-auto pr-1">
                        {domainTribes.map((t) => (
                          <TribeSelectCard
                            key={t.id}
                            tribe={t}
                            selected={tribeId === t.id}
                            onSelect={() => void loadTribe(t.id)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}

                {tribeLoading && (
                  <div className="flex items-center gap-2 text-[13px] text-muted">
                    <Spinner /> Loading tribe…
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
                <div className="space-y-2 max-h-[26rem] overflow-y-auto pr-1">
                  {tribe.users.map((u, i) => (
                    <UserSelectCard
                      key={u.id}
                      index={i}
                      user={u}
                      selected={u.id === userId}
                      onSelect={() => selectUser(u.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {step === 2 && user && tribe && (
              <div className="space-y-4">
                <div className="space-y-2 max-h-[20rem] overflow-y-auto pr-1">
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
                      <p className="text-[13px] text-foreground leading-snug line-clamp-2">
                        {p.productDescription}
                      </p>
                      <p className="text-[11px] text-muted-2 mt-1.5">
                        {p.category}
                      </p>
                    </button>
                  ))}
                </div>
                {product && (
                  <>
                    <ProductDescriptionEditor
                    value={customProductDesc}
                    onChange={(v) => {
                      setCustomProductDesc(v);
                      resetOutputs();
                    }}
                    category={effectiveCategory}
                  />
                  </>
                )}
              </div>
            )}

            {step === 3 && (
              <div>
                <ProductDescriptionEditor
                  value={customProductDesc}
                  onChange={(v) => {
                    setCustomProductDesc(v);
                    resetOutputs();
                  }}
                  category={effectiveCategory}
                  compact
                />

                <div className="flex flex-wrap items-center gap-3 mb-4 mt-4">
                  {runningSapiens && (
                    <span className="text-[13px] text-muted flex items-center gap-1.5">
                      <Spinner /> Running Sapiens…
                    </span>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <ResultCard
                    tone="real"
                    title="Real review"
                    subtitle="ground truth"
                    text={groundTruth ?? undefined}
                    predictedThemes={gtThemeRecord}
                    sentiment={groundTruthSentiment}
                  />
                  <ResultCard
                    tone="sapiens"
                    title="Sapiens"
                    loading={runningSapiens}
                    text={sapiens?.reviewText}
                    predictedThemes={sapiens?.predictedThemes}
                    sentiment={sapiens?.sentiment}
                    metrics={sapiens?.metrics}
                    error={sapiens?.error}
                    latencyMs={sapiens?.latencyMs}
                  />
                </div>
              </div>
            )}

            {step === 4 && (
              <div>
                <ProductDescriptionEditor
                  value={customProductDesc}
                  onChange={(v) => {
                    setCustomProductDesc(v);
                    resetOutputs();
                  }}
                  category={effectiveCategory}
                  compact
                />

                <div className="space-y-5 mb-6 mt-4">
                  <div>
                    <Label>Baseline method</Label>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {BASELINE_METHODS.map((m) => (
                        <button
                          key={m}
                          onClick={() => selectBaselineMethod(m)}
                          className={`text-left rounded-xl border p-3 transition ${
                            baselineMethod === m
                              ? "border-accent bg-accent/[0.04]"
                              : "border-border hover:border-border-strong"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Dot tone={BASELINE_METHOD_META[m].tone} />
                            <span className="text-[13px] font-medium">
                              {BASELINE_METHOD_META[m].label}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {baselineMethod === "history" && (
                    <HistoryContextPanel
                      items={historyPreview}
                      loading={historyPreviewLoading}
                      targetCategory={effectiveCategory}
                    />
                  )}

                  {baselineMethod === "population_persona" && (
                    <div className="rounded-xl border border-border bg-surface-2/40 p-4 space-y-3">
                      <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useCustomPopulationDef}
                          onChange={(e) => setUseCustomPopulationDef(e.target.checked)}
                          className="rounded border-border"
                        />
                        <span>Use custom population definition</span>
                      </label>
                      {useCustomPopulationDef ? (
                        <textarea
                          value={customPopulationDef}
                          onChange={(e) => setCustomPopulationDef(e.target.value)}
                          rows={5}
                          placeholder="Describe the population persona to send as context…"
                          className="w-full rounded-lg border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-foreground leading-relaxed resize-y min-h-[6rem]"
                        />
                      ) : (
                        <p className="text-[12px] text-muted leading-relaxed line-clamp-4">
                          {tribe?.populationDefinition || "Default population definition for this tribe."}
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <Label>Model — click to run</Label>
                    <div className="flex flex-wrap gap-2">
                      {BASELINE_MODELS.map((m) => {
                        const key = baselineKey(baselineMethod, m);
                        const isRunning = runningBaselineKey === key;
                        const isDone = baselines.some((b) => b.key === key);
                        return (
                          <button
                            key={m}
                            onClick={() => void doRunBaseline(baselineMethod, m)}
                            disabled={isRunning || isDone || !canRun}
                            className={`chip flex items-center gap-1.5 ${
                              isDone ? "border-real/40 text-real" : isRunning ? "border-accent text-accent" : ""
                            }`}
                          >
                            {isRunning && <Spinner />}
                            {m}
                            {isDone && <span className="text-[10px]">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                    {runningBaselineKey && (
                      <p className="text-[12px] text-muted mt-2 flex items-center gap-1.5">
                        <Spinner /> Running…
                      </p>
                    )}
                  </div>
                  </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <ResultCard
                    tone="real"
                    title="Real review"
                    subtitle="ground truth"
                    text={groundTruth ?? undefined}
                    predictedThemes={gtThemeRecord}
                    sentiment={groundTruthSentiment}
                  />
                  <ResultCard
                    tone="sapiens"
                    title="Sapiens"
                    text={sapiens?.reviewText}
                    predictedThemes={sapiens?.predictedThemes}
                    sentiment={sapiens?.sentiment}
                    metrics={sapiens?.metrics}
                    error={sapiens?.error}
                    latencyMs={sapiens?.latencyMs}
                  />
                  {baselines.map((b) => (
                    <ResultCard
                      key={b.key}
                      tone={BASELINE_METHOD_META[b.method].tone}
                      title={baselineDisplayLabel(b)}
                      text={b.reviewText}
                      predictedThemes={b.predictedThemes}
                      sentiment={b.sentiment}
                      metrics={b.metrics}
                      error={b.error}
                      latencyMs={b.latencyMs}
                      historyContext={b.method === "history" ? b.historyContext : undefined}
                      onRemove={() => removeBaseline(b.key)}
                    />
                  ))}
                  {runningBaselineKey && runningBaselineMethod && runningBaselineModel &&
                    !baselines.some((b) => b.key === runningBaselineKey) && (
                    <ResultCard
                      tone={BASELINE_METHOD_META[runningBaselineMethod].tone}
                      title={
                        runningBaselineKey.endsWith(":custom")
                          ? `${baselineLabel(runningBaselineMethod, runningBaselineModel)} (custom def)`
                          : baselineLabel(runningBaselineMethod, runningBaselineModel)
                      }
                      loading
                    />
                  )}
                </div>

                {baselines.length > 0 && sapiens?.metrics && (
                  <ScoreboardTable sapiens={sapiens} baselines={baselines} />
                )}

                <div className="mt-6 pt-4 border-t border-border">
                  <button
                    type="button"
                    onClick={openBenchmarking}
                    disabled={!tribeId}
                    className="text-[13px] text-accent hover:underline disabled:opacity-40"
                  >
                    View benchmarking →
                  </button>
                </div>
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
              (step === 3 && (runningSapiens || !sapiens))
            }
            className="btn btn-primary px-6 py-2 text-sm"
          >
            {step === 3 ? "Compare baselines" : "Continue"}
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
        {connected ? "Gateway" : "Mock mode"}
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
      </button>
      {open && (
        <div className="mt-4 space-y-4 max-h-[24rem] overflow-y-auto">
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

function TribeSelectCard({
  tribe,
  selected,
  onSelect,
}: {
  tribe: CatalogTribeIndex;
  selected: boolean;
  onSelect: () => void;
}) {
  const description = tribe.description?.trim() ?? "";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-xl border p-3.5 transition ${
        selected ? "border-accent bg-accent/[0.04]" : "border-border hover:border-border-strong"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Dot tone="sapiens" />
        <span className="text-[13px] font-semibold leading-snug">{tribe.name}</span>
        {tribe.domain && (
          <span className="text-[10px] uppercase tracking-wide text-muted-2 ml-auto shrink-0">
            {tribe.domain === "healthcare" ? "Healthcare" : "Video Games"}
          </span>
        )}
      </div>
      {description && (
        <p className="text-[12px] text-muted leading-relaxed">{description}</p>
      )}
    </button>
  );
}

function UserSelectCard({
  user,
  index,
  selected,
  onSelect,
}: {
  user: CatalogTribe["users"][number];
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = user.characteristicSummary?.trim();
  const categoryEntry = Object.entries(user.categoryCharacteristics ?? {})[0];
  const categoryLabel = categoryEntry?.[0];
  const categoryText = categoryEntry?.[1]?.trim() ?? "";
  const combined = [summary, categoryText ? `${categoryLabel}: ${categoryText}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const canExpand = combined.length > 160;

  return (
    <div
      className={`rounded-xl border p-3.5 transition ${
        selected ? "border-accent bg-accent/[0.04]" : "border-border hover:border-border-strong"
      }`}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-mono text-muted-2">#{index + 1}</span>
          <span className="text-[12.5px] font-medium text-foreground">Modelled user</span>
        </div>
        {summary && (
          <p
            className={`text-[12.5px] text-muted leading-relaxed ${
              expanded ? "" : "line-clamp-3"
            }`}
          >
            {summary}
          </p>
        )}
        {categoryText && (
          <div className={summary ? "mt-2.5 pt-2.5 border-t border-border/60" : ""}>
            <p className="text-[10px] uppercase tracking-wide text-muted-2 mb-1">
              {categoryLabel}
            </p>
            <p
              className={`text-[12.5px] text-muted leading-relaxed ${
                expanded ? "" : "line-clamp-3"
              }`}
            >
              {categoryText}
            </p>
          </div>
        )}
      </button>
      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-accent hover:underline mt-2"
        >
          {expanded ? "Show less" : "Show full characteristics"}
        </button>
      )}
    </div>
  );
}

function baselineDisplayLabel(b: BaselineResult) {
  const base = baselineLabel(b.method, b.baselineModel);
  return b.key.endsWith(":custom") ? `${base} (custom def)` : base;
}

function ProductDescriptionEditor({
  value,
  onChange,
  category,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  category?: string;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-border bg-surface-2/40 ${compact ? "p-3" : "p-4"}`}>
      <Label>Product description</Label>
      {category && (
        <p className="text-[11px] text-muted-2 mb-2">{category}</p>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={compact ? 3 : 4}
        placeholder="Write or edit the product description used for predictions…"
        className="w-full rounded-lg border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-foreground leading-relaxed resize-y min-h-[4.5rem]"
      />
    </div>
  );
}

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value * 100)}%`;
}

function ScoreboardTable({
  sapiens,
  baselines,
}: {
  sapiens: EngineResult;
  baselines: BaselineResult[];
}) {
  const rows = [
    { label: "Sapiens", metrics: sapiens.metrics, highlight: true },
    ...baselines.map((b) => ({
      label: baselineDisplayLabel(b),
      metrics: b.metrics,
      highlight: false,
    })),
  ]
    .filter((r) => r.metrics)
    .sort(
      (a, b) =>
        (b.metrics?.overallSimilarityScore ?? 0) - (a.metrics?.overallSimilarityScore ?? 0),
    );

  return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border bg-surface-2 text-left text-muted-2">
            <th className="px-4 py-2.5 font-medium">Mode</th>
            <th className="px-4 py-2.5 font-medium">Overall</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.label}
              className={`border-b border-border last:border-0 ${r.highlight ? "bg-accent/[0.04]" : ""}`}
            >
              <td className="px-4 py-2.5 font-medium">{r.label}</td>
              <td className="px-4 py-2.5 font-medium">{fmtPct(r.metrics?.overallSimilarityScore)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryContextPanel({
  items,
  loading,
  targetCategory,
}: {
  items: HistoryContextItem[] | null;
  loading: boolean;
  targetCategory: string;
}) {
  const [open, setOpen] = useState(true);
  const count = items?.length ?? 0;
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-4 space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-left gap-3"
      >
        <div>
          <p className="text-[13px] font-medium text-foreground">User history sent as context</p>
          <p className="text-[11px] text-muted-2 mt-0.5">
            Reviews from this user&apos;s history (review text only)
          </p>
        </div>
        <span className="text-[12px] text-muted shrink-0">
          {loading ? "Loading…" : `${count} review${count === 1 ? "" : "s"}`}
        </span>
      </button>
      {open && !loading && (
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
          {count === 0 ? (
            <p className="text-[12px] text-muted-2">
              No user history is available for this user.
            </p>
          ) : (
            items?.map((item, i) => (
              <div key={i} className="rounded-lg border border-border bg-surface-1 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-2 mb-1.5">
                  Example {i + 1}
                </p>
                <p className="text-[12.5px] text-foreground/90 whitespace-pre-wrap leading-relaxed">
                  {item.reviewText.replace(/<br\s*\/?>/gi, "\n")}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
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
  historyContext,
  onRemove,
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
  historyContext?: HistoryContextItem[];
  onRemove?: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const isGenerated = tone !== "real";
  const showSkeleton = loading && isGenerated && !text;
  const themeEntries = Object.entries(predictedThemes ?? {}).sort((a, b) => b[1] - a[1]);
  const hasDetails = themeEntries.length > 0 || sentiment;
  return (
    <div className="rounded-xl border border-border p-4 flex flex-col">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <Dot tone={tone} />
          <span className="text-[13px] font-medium">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {latencyMs ? (
            <span className="text-[11px] text-muted-2">{(latencyMs / 1000).toFixed(1)}s</span>
          ) : null}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-[11px] text-muted-2 hover:text-foreground"
              aria-label="Remove"
            >
              ✕
            </button>
          )}
        </div>
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
              style={{ width: `${Math.min(100, Math.max(0, metrics.overallSimilarityScore * 100))}%` }}
            />
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
      {historyContext && historyContext.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <button
            type="button"
            onClick={() => setContextOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] text-muted-2 hover:text-muted transition w-full text-left"
          >
            <span className={`transition-transform text-[10px] ${contextOpen ? "rotate-90" : ""}`}>▶</span>
            Context reviews ({historyContext.length})
          </button>
          {contextOpen && (
            <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
              {historyContext.map((item, i) => (
                <p key={i} className="text-[11px] text-muted leading-relaxed whitespace-pre-wrap">
                  <span className="text-muted-2">Ex {i + 1}: </span>
                  {item.reviewText.slice(0, 280)}
                  {item.reviewText.length > 280 ? "…" : ""}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      {hasDetails && text && (
        <div className="mt-3 pt-3 border-t border-border">
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] text-muted-2 hover:text-muted transition w-full text-left"
          >
            <span className={`transition-transform text-[10px] ${detailsOpen ? "rotate-90" : ""}`}>▶</span>
            Themes &amp; sentiment
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
                      {value !== 1 && (
                        <span className="text-muted-2 tabular-nums w-8 text-right">{value.toFixed(2)}</span>
                      )}
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
