"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PiHeadCircuit } from "react-icons/pi";
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
  PipelineMetrics,
  ReviewSentiment,
  SapiensRunResponse,
} from "@/lib/types";
import {
  clearWizardRestoreFlag,
  loadWizardSession,
  saveWizardSession,
} from "@/lib/wizard-session";
import { topKThemeEntries, topKThemeEntriesForSapiensDisplay, themeTopKFromGroundTruth } from "@/lib/scoring";

const DOMAIN_SECTIONS = [
  { id: "video_games" as const, label: "Video Games & Software" },
  { id: "healthcare" as const, label: "Healthcare & Wellness" },
];

/** Shared type scale — keep labels/titles/body consistent across the wizard. */
const TYPE = {
  pageTitle: "text-[22px] font-semibold tracking-tight text-foreground",
  subtitle: "text-[14px] font-normal text-foreground",
  sectionLabel: "text-[11px] font-semibold uppercase tracking-wider text-accent",
  cardTitle: "text-[13px] font-semibold text-foreground leading-snug",
  body: "text-[13px] font-normal text-foreground leading-relaxed",
  bodyMuted: "text-[13px] font-normal text-foreground leading-relaxed",
  meta: "text-[13px] font-normal text-foreground",
  link: "text-[13px] font-medium text-accent hover:underline",
} as const;

const STEPS = [
  { id: "tribe", label: "Tribe", title: "SAPIENS Modeled Tribe", hint: "Select a behavioral tribe to model." },
  { id: "user", label: "User", title: "Pick a modeled user", hint: "" },
  { id: "product", label: "Product", title: "Pick a product", hint: "Choose a product from this user." },
  { id: "sapiens", label: "SAPIENS", title: "SAPIENS prediction", hint: "What SAPIENS generates vs the real review." },
  { id: "compare", label: "Compare", title: "Compare baselines", hint: "Run baselines and compare scores against SAPIENS." },
];

function defaultReviewKeyForUser(user: CatalogTribe["users"][number] | null | undefined): string | null {
  if (!user?.products.length) return null;
  return user.products[0]?.reviewKey ?? null;
}

/** Prompt/scoring product text — product_description only (never main_product_description). */
function catalogProductDescription(product: { productDescription: string }): string {
  return product.productDescription.trim();
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

  const [userId, setUserId] = useState("");
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const [customProductDesc, setCustomProductDesc] = useState("");

  const [baselineMethod, setBaselineMethod] = useState<BaselineMethod>("history");
  const [useCustomPopulationDef, setUseCustomPopulationDef] = useState(false);
  const [customPopulationDef, setCustomPopulationDef] = useState("");

  const [groundTruth, setGroundTruth] = useState<string | null>(null);
  const [groundTruthThemes, setGroundTruthThemes] = useState<string[]>([]);
  const [groundTruthSentiment, setGroundTruthSentiment] = useState<ReviewSentiment | null>(null);
  const [themeTopK, setThemeTopK] = useState(0);
  const [sapiens, setSapiens] = useState<EngineResult | null>(null);
  const [baselines, setBaselines] = useState<BaselineResult[]>([]);

  const [runningSapiens, setRunningSapiens] = useState(false);
  const [editDescOpen, setEditDescOpen] = useState(false);
  const [editPopulationOpen, setEditPopulationOpen] = useState(false);
  const [runningBaselineKey, setRunningBaselineKey] = useState<string | null>(null);
  const [runningBaselineMethod, setRunningBaselineMethod] = useState<BaselineMethod | null>(null);
  const [runningBaselineModel, setRunningBaselineModel] = useState<BaselineModel | null>(null);

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
    if (product) setCustomProductDesc(catalogProductDescription(product));
  }, [product?.reviewKey, product?.mainProductDescription, product?.productDescription]);

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
    if (!tribeIndex?.length || tribeId || restoredRef.current) return;
    const saved = loadWizardSession();
    if (saved?.tribeId) return;

    const ordered = DOMAIN_SECTIONS.flatMap(({ id: domain }) =>
      tribeIndex.filter((t) => t.domain === domain),
    );
    const first = ordered[0] ?? tribeIndex[0];
    if (first) void loadTribe(first.id);
  }, [tribeIndex, tribeId]);

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
    setThemeTopK(themeTopKFromGroundTruth(saved.groundTruthThemes));
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
    if (!product) {
      setGroundTruthThemes([]);
      setGroundTruthSentiment(null);
      setThemeTopK(0);
      return;
    }
    const themes = product.groundTruthThemes ?? [];
    setGroundTruthThemes(themes);
    setGroundTruthSentiment(product.groundTruthSentiment ?? null);
    setThemeTopK(themeTopKFromGroundTruth(themes));
  }, [product]);

  function resetOutputs() {
    setSapiens(null);
    setBaselines([]);
    setGroundTruth(null);
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
      setThemeTopK(
        data.themeTopK ?? themeTopKFromGroundTruth(data.groundTruthThemes ?? []),
      );
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
        if (data.themeTopK != null) setThemeTopK(data.themeTopK);
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
    <div className={`mx-auto w-full px-6 py-8 sm:py-12 ${step === 0 ? "max-w-6xl" : "max-w-4xl"}`}>
      <Header connected={gatewayConnected} />

      <Stepper step={step} onStep={goTo} />

      <div className="mt-8 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className={TYPE.pageTitle}>{STEPS[step].title}</h1>
            {step === 0 && tribe ? (
              <div className="mt-1.5 space-y-1">
                <p className="text-[15px] font-medium text-foreground">{tribe.name}</p>
                {tribe.populationDefinition?.trim() ? (
                  <p className="text-[14px] font-normal text-foreground leading-relaxed max-w-3xl">
                    {tribe.populationDefinition.trim()}
                  </p>
                ) : null}
              </div>
            ) : step === 1 && tribe ? (
              <div className="mt-1.5 space-y-1">
                <p className="text-[15px] font-medium text-foreground">{tribe.name}</p>
                {tribe.populationDefinition?.trim() ? (
                  <p className="text-[14px] font-normal text-foreground leading-relaxed max-w-3xl">
                    {tribe.populationDefinition.trim()}
                  </p>
                ) : null}
              </div>
            ) : STEPS[step].hint ? (
              <p className={`${TYPE.subtitle} mt-1`}>{STEPS[step].hint}</p>
            ) : null}
            {step > 1 && tribe ? (
              <p className="text-[15px] font-medium text-foreground mt-1.5">{tribe.name}</p>
            ) : null}
          </div>
          {tribeId && (
            <button type="button" onClick={openBenchmarking} className={`shrink-0 ${TYPE.link}`}>
              View benchmarking →
            </button>
          )}
        </div>
      </div>

      {step === 0 && tribeIndex ? (
        <div
          className={`grid gap-5 lg:gap-6 animate-in ${
            tribeId
              ? "lg:grid-cols-[minmax(0,1fr)_min(24rem,38%)] lg:items-stretch"
              : "lg:grid-cols-1"
          }`}
          key="tribe-step"
        >
          <section
            className={`card p-6 sm:p-7 min-w-0 flex flex-col ${
              tribeId ? "lg:h-[min(36rem,70vh)]" : ""
            }`}
          >
            <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-6">
              {DOMAIN_SECTIONS.map(({ id: domain, label }) => {
                const domainTribes = tribeIndex.filter((t) => t.domain === domain);
                if (domainTribes.length === 0) return null;
                return (
                  <div key={domain} className="space-y-2.5">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-accent px-0.5">
                      {label}
                    </h3>
                    <div className="grid gap-2.5 sm:grid-cols-2">
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
                <div className={`flex items-center gap-2 ${TYPE.meta} px-0.5`}>
                  <Spinner /> Loading tribe…
                </div>
              )}
            </div>
          </section>

          {tribeId && (
            <aside className="min-w-0 lg:h-[min(36rem,70vh)]">
              {tribe && !tribeLoading ? (
                <LearnedTribePanel tribe={tribe} />
              ) : (
                <div className="h-full rounded-[20px] border border-accent/30 bg-accent/15 ring-1 ring-accent/30 flex items-center justify-center">
                  <span className="flex items-center gap-2 text-[13px] font-normal text-foreground/50">
                    <Spinner /> Loading…
                  </span>
                </div>
              )}
            </aside>
          )}
        </div>
      ) : (
      <section className="card p-6 sm:p-7 animate-in" key={step}>
        {!tribeIndex ? (
          <LoadingBlock />
        ) : (
          <>
            {step === 1 && tribe && (
              <div className="space-y-2.5 max-h-[min(36rem,70vh)] overflow-y-auto pr-1">
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
            )}

            {step === 2 && user && tribe && (
              <div className="space-y-4">
                <div className="space-y-2 max-h-[20rem] overflow-y-auto pr-1">
                  {user.products.map((p, i) => (
                    <button
                      key={p.reviewKey}
                      onClick={() => selectProduct(p.reviewKey)}
                      className={`w-full text-left rounded-xl border-2 p-3.5 transition ${
                        p.reviewKey === reviewKey
                          ? "border-accent bg-accent/15"
                          : "border-transparent hover:border-border-strong bg-surface border border-border"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-mono font-normal text-foreground/50">#{i + 1}</span>
                      </div>
                      <p className="text-[13px] font-normal text-foreground leading-snug line-clamp-3">
                        {catalogProductDescription(p)}
                      </p>
                      {p.mainProductDescription &&
                        p.mainProductDescription.trim() !== p.productDescription.trim() && (
                          <p className="text-[11px] font-normal text-foreground/60 mt-1 line-clamp-1">
                            {p.mainProductDescription}
                          </p>
                        )}
                      <p className="text-[11px] font-normal text-foreground/60 mt-1.5">
                        {p.category}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                {runningSapiens && (
                  <span className="text-[13px] font-normal text-foreground/60 flex items-center gap-1.5">
                    <Spinner /> Running SAPIENS…
                  </span>
                )}

                {/* ── Overall similarity banner ── */}
                {sapiens?.metrics?.overallSimilarityScore !== null &&
                  sapiens?.metrics?.overallSimilarityScore !== undefined && (
                  <div className="rounded-2xl border border-accent/30 bg-accent/15 px-6 py-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-foreground">Overall similarity</span>
                      <div className="flex items-baseline gap-2">
                        <span className="text-[22px] font-bold text-foreground tabular-nums leading-none">
                          {fmtPct(sapiens.metrics.overallSimilarityScore)}
                        </span>
                        {sapiens.metrics.isMatch !== null && (
                          <span className={`text-[12px] font-semibold ${sapiens.metrics.isMatch ? "text-real" : "text-foreground/40"}`}>
                            {sapiens.metrics.isMatch ? "· match" : "· no match"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-surface-3 overflow-hidden border border-accent/30">
                      <div
                        className="h-full rounded-full bg-accent transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, sapiens.metrics.overallSimilarityScore * 100))}%` }}
                      />
                    </div>
                    {sapiens.similarityExplanation && (
                      <p className="text-[13px] font-normal text-foreground leading-relaxed mt-2.5">
                        {sapiens.similarityExplanation}
                      </p>
                    )}
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2 items-stretch">
                  <ResultCard
                    key={groundTruth ?? "real"}
                    tone="real"
                    title="Real Review (Ground Truth)"
                    text={groundTruth ?? undefined}
                    predictedThemes={gtThemeRecord}
                    sentiment={groundTruthSentiment}
                    themeTopK={themeTopK}
                  />
                  <ResultCard
                    key={sapiens?.reviewText ?? "sapiens"}
                    tone="sapiens"
                    title="SAPIENS"
                    loading={runningSapiens}
                    text={sapiens?.reviewText}
                    predictedThemes={sapiens?.predictedThemes}
                    sentiment={sapiens?.sentiment}
                    error={sapiens?.error}
                    latencyMs={sapiens?.latencyMs}
                    themeTopK={themeTopK}
                    sapiensThemeDisplay
                    themeDisplayGroundTruth={groundTruthThemes}
                  />
                </div>
              </div>
            )}

            {step === 4 && (
              <div>
                {/* ── Product description ── */}
                <div className="mb-5">
                  <button
                    type="button"
                    onClick={() => setEditDescOpen((v) => !v)}
                    className="inline-flex items-center gap-2 text-[13px] font-semibold text-accent bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-lg px-3.5 py-2 transition"
                  >
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                      <path d="M11.8536 1.14645C11.6583 0.951184 11.3417 0.951184 11.1465 1.14645L3.71455 8.57836C3.62459 8.66832 3.55263 8.77461 3.50251 8.89155L2.04044 12.303C1.9599 12.491 2.00189 12.709 2.14646 12.8536C2.29103 12.9981 2.50905 13.0401 2.69697 12.9596L6.10847 11.4975C6.2254 11.4474 6.3317 11.3754 6.42166 11.2855L13.8536 3.85355C14.0488 3.65829 14.0488 3.34171 13.8536 3.14645L11.8536 1.14645ZM4.42166 9.28547L11.5 2.20711L12.7929 3.5L5.71455 10.5784L4.21924 11.2192L3.78081 10.7808L4.42166 9.28547Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"/>
                    </svg>
                    {editDescOpen ? "Done editing" : "Edit Product Description"}
                  </button>
                  {editDescOpen && (
                    <textarea
                      value={customProductDesc}
                      onChange={(e) => { setCustomProductDesc(e.target.value); resetOutputs(); }}
                      rows={6}
                      placeholder="Write or edit the main product description…"
                      className="mt-3 w-full rounded-xl border-2 border-accent/40 bg-surface px-4 py-3 text-[13px] font-normal text-foreground leading-relaxed resize-y focus:outline-none focus:border-accent"
                    />
                  )}
                </div>

                <div className="space-y-5 mb-6 mt-4">
                  <div>
                    <Label>Baseline method</Label>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {BASELINE_METHODS.map((m) => (
                        <button
                          key={m}
                          onClick={() => selectBaselineMethod(m)}
                          className={`text-left rounded-xl border-2 p-3 transition ${
                            baselineMethod === m
                              ? "border-accent bg-accent/15"
                              : "border-transparent hover:border-border-strong bg-surface border border-border"
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

                  {baselineMethod === "population_persona" && (
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setUseCustomPopulationDef((v) => !v)}
                        className={`inline-flex items-center gap-2 text-[13px] font-semibold rounded-lg px-3.5 py-2 border transition ${
                          useCustomPopulationDef
                            ? "bg-accent/10 text-accent border-accent/30 hover:bg-accent/20"
                            : "bg-surface border-border text-foreground hover:bg-surface-3"
                        }`}
                      >
                        <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border-2 shrink-0 transition ${
                          useCustomPopulationDef ? "bg-accent border-accent" : "border-foreground/20"
                        }`}>
                          {useCustomPopulationDef && (
                            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                              <path d="M1.5 4L3 5.5L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </span>
                        {useCustomPopulationDef ? "Using custom definition" : "Use custom definition"}
                      </button>

                      {useCustomPopulationDef ? (
                        <textarea
                          value={customPopulationDef}
                          onChange={(e) => setCustomPopulationDef(e.target.value)}
                          rows={4}
                          placeholder="Describe the population persona to send as context…"
                          className="w-full rounded-xl border-2 border-accent/40 bg-surface px-4 py-3 text-[13px] font-normal text-foreground leading-relaxed resize-y min-h-[5rem] focus:outline-none focus:border-accent"
                        />
                      ) : (
                        <p className="text-[13px] font-normal text-foreground/60 leading-relaxed">
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
                      <p className="text-[12px] font-normal text-foreground/60 mt-2 flex items-center gap-1.5">
                        <Spinner /> Running…
                      </p>
                    )}
                  </div>
                  </div>

                <div className="grid gap-5 sm:grid-cols-2 items-stretch">
                  <ResultCard
                    key={groundTruth ?? "real-4"}
                    tone="real"
                    title="Real Review (Ground Truth)"
                    text={groundTruth ?? undefined}
                    predictedThemes={gtThemeRecord}
                    sentiment={groundTruthSentiment}
                    themeTopK={themeTopK}
                  />
                  <ResultCard
                    key={sapiens?.reviewText ?? "sapiens-4"}
                    tone="sapiens"
                    title="SAPIENS"
                    text={sapiens?.reviewText}
                    predictedThemes={sapiens?.predictedThemes}
                    sentiment={sapiens?.sentiment}
                    metrics={sapiens?.metrics}
                    error={sapiens?.error}
                    latencyMs={sapiens?.latencyMs}
                    themeTopK={themeTopK}
                    sapiensThemeDisplay
                    themeDisplayGroundTruth={groundTruthThemes}
                    similarityExplanation={sapiens?.similarityExplanation}
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
                      themeTopK={themeTopK}
                      similarityExplanation={b.similarityExplanation}
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
                      themeTopK={themeTopK}
                    />
                  )}
                </div>

                {baselines.length > 0 && sapiens?.metrics && (
                  <ScoreboardTable sapiens={sapiens} baselines={baselines} />
                )}
              </div>
            )}
          </>
        )}
      </section>
      )}

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

      <footer className="text-center text-xs font-normal text-foreground/40 mt-12">
        SAPIENS Benchmark ·{" "}
        <a href="https://runvectorial.com" className="hover:text-foreground transition" target="_blank" rel="noreferrer">
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
        <span className="text-[13px] font-normal text-foreground/50">SAPIENS Benchmark</span>
      </div>
      <span className="inline-flex items-center gap-1.5 text-xs font-normal text-foreground/50">
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
                  active ? "bg-accent text-white" : done ? "bg-accent text-white" : "bg-surface-3 text-foreground/40"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={`text-[12px] font-medium hidden md:inline ${active || done ? "text-foreground" : "text-foreground/40"}`}>
                {s.label}
              </span>
            </button>
            {i < STEPS.length - 1 && <span className={`h-px flex-1 mx-2 min-w-[12px] ${done ? "bg-accent" : "bg-border"}`} />}
          </div>
        );
      })}
    </nav>
  );
}

function LearnedTribePanel({ tribe }: { tribe: CatalogTribe }) {
  const q = tribe.qualitative;
  const groups: { key: keyof typeof q; label: string; items: string[] }[] = [
    { key: "inherentBehavioralTraits", label: "Inherent behavioral traits", items: q.inherentBehavioralTraits },
    { key: "latentMotivations", label: "Latent motivations", items: q.latentMotivations },
    { key: "validationTriggers", label: "Validation triggers", items: q.validationTriggers },
    { key: "frictionPoints", label: "Friction points", items: q.frictionPoints },
    { key: "implicitGoals", label: "Implicit goals", items: q.implicitGoals },
  ];
  const traitCount = groups.reduce((n, g) => n + g.items.length, 0);
  const groupCount = groups.filter((g) => g.items.length).length;

  return (
      <div className="h-full flex flex-col overflow-hidden rounded-[20px] border border-accent/30 bg-accent/15 ring-1 ring-accent/30 shadow-lg shadow-accent/15">
      <div className="shrink-0 px-4 sm:px-5 pt-4 sm:pt-5 pb-3">
        <div className="flex items-start gap-2.5">
          <PiHeadCircuit
            className="shrink-0 mt-px text-accent"
            size={28}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <h2 className={TYPE.cardTitle}>SAPIENS Modeled Latent Traits of the Tribe</h2>
            <p className={`${TYPE.meta} mt-0.5`}>
              {traitCount} traits · {groupCount} groups
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-5 pb-4 sm:pb-5 space-y-2">
        {groups.map((g) => (
          <TraitGroupDrawer
            key={g.key}
            label={g.label}
            items={g.items}
            defaultOpen={g.key !== "inherentBehavioralTraits"}
          />
        ))}
      </div>
    </div>
  );
}

function TraitGroupDrawer({
  label,
  items,
  defaultOpen = false,
}: {
  label: string;
  items: string[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-accent/15 bg-white/80 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full px-3.5 py-2.5 text-left hover:bg-white transition"
      >
        <span className="flex items-center gap-2">
          <span className={`transition-transform text-[10px] text-foreground/40 ${open ? "rotate-90" : ""}`}>▶</span>
          <span className={TYPE.cardTitle}>{label}</span>
        </span>
        <span className="text-[13px] font-normal text-foreground/50 tabular-nums">{items.length}</span>
      </button>
      {open && (
        <ul className="px-3.5 pb-3 pt-1 space-y-2 border-t border-accent/25">
          {items.map((it, i) => (
            <li key={i} className="text-[13px] font-normal text-foreground leading-relaxed flex gap-2">
              <span className="text-foreground/40 shrink-0 select-none" aria-hidden>
                •
              </span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      )}
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
        selected
          ? "border-2 border-accent bg-accent/15"
          : "border-border hover:border-border-strong bg-surface-1"
      }`}
    >
      <p className="text-[13px] font-semibold text-foreground leading-snug">{tribe.name}</p>
      {description ? (
        <p className="text-[13px] font-normal text-foreground leading-relaxed mt-1.5">{description}</p>
      ) : null}
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
  const summary = user.characteristicSummary?.trim();
  const categoryEntry = Object.entries(user.categoryCharacteristics ?? {})[0];
  const categoryLabel = categoryEntry?.[0];
  const categoryText = categoryEntry?.[1]?.trim() ?? "";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-2xl border transition-all duration-150 overflow-hidden ${
        selected
          ? "border-2 border-accent bg-accent/15"
          : "border-border hover:border-border-strong bg-surface"
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2 flex-wrap">
        <span className={`text-[12px] font-bold tabular-nums shrink-0 ${selected ? "text-accent" : "text-foreground/50"}`}>
          #{index + 1}
        </span>
        <span className="text-[12px] font-semibold text-foreground">
          Modeled User after Real User ID:
        </span>
        <span className="text-[11px] font-mono font-normal text-foreground/60 truncate" title={user.id}>
          {user.id}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 pb-3.5 space-y-2">
        {summary ? (
          <p className="text-[13px] font-normal text-foreground leading-relaxed">{summary}</p>
        ) : null}
        {categoryText ? (
          <div className={`pt-2 border-t ${selected ? "border-accent/50" : "border-border"}`}>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
              {categoryLabel}
            </span>
            <p className="text-[13px] font-normal text-foreground leading-relaxed mt-1">{categoryText}</p>
          </div>
        ) : null}
      </div>
    </button>
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
      <Label>Main product description</Label>
      {category && (
        <p className="text-[11px] font-normal text-foreground/60 mb-2">{category}</p>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={compact ? 3 : 4}
        placeholder="Write or edit the main product description used for predictions…"
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
    { label: "SAPIENS", metrics: sapiens.metrics, highlight: true },
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
          <tr className="border-b border-border bg-surface-2 text-left text-foreground/60">
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
  themeTopK,
  sapiensThemeDisplay,
  themeDisplayGroundTruth,
  similarityExplanation,
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
  themeTopK: number;
  /** Sapiens only: recall@k theme list (best recall among tied scores). */
  sapiensThemeDisplay?: boolean;
  themeDisplayGroundTruth?: string[];
  similarityExplanation?: string | null;
  onRemove?: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isGenerated = tone !== "real";
  const showSkeleton = loading && isGenerated && !text;
  const themeEntries = sapiensThemeDisplay
    ? topKThemeEntriesForSapiensDisplay(
        predictedThemes,
        themeTopK,
        themeDisplayGroundTruth,
      )
    : topKThemeEntries(predictedThemes, themeTopK);
  const hasDetails = themeEntries.length > 0 || sentiment;

  return (
    <div className="rounded-2xl border border-border bg-surface flex flex-col overflow-hidden">

      {/* ── Card header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface-2/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <Dot tone={tone} />
          <span className="text-[14px] font-semibold text-foreground leading-none">{title}</span>
          {subtitle && (
            <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground/40 ml-1">
              {subtitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {latencyMs ? (
            <span className="text-[11px] font-normal text-foreground/40 tabular-nums">{(latencyMs / 1000).toFixed(1)}s</span>
          ) : null}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-[11px] text-foreground/40 hover:text-foreground transition"
              aria-label="Remove"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Similarity block (generated cards only) ── */}
      {metrics?.overallSimilarityScore !== null && metrics?.overallSimilarityScore !== undefined && (
        <div className="px-6 py-5 border-b border-border bg-accent/15">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-foreground">Overall similarity</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[20px] font-bold text-foreground tabular-nums leading-none">
              {fmtPct(metrics.overallSimilarityScore)}
            </span>
              {metrics.isMatch !== null && (
                <span className={`text-[11px] font-medium ${metrics.isMatch ? "text-real" : "text-foreground/40"}`}>
                  {metrics.isMatch ? "match" : "no match"}
                </span>
              )}
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden border border-accent/30">
            <div
              className={`h-full rounded-full transition-all ${TONE_BG[tone]}`}
              style={{ width: `${Math.min(100, Math.max(0, metrics.overallSimilarityScore * 100))}%` }}
            />
          </div>
          {similarityExplanation && (
            <p className="text-[12px] font-normal text-foreground leading-relaxed mt-2.5">{similarityExplanation}</p>
          )}
        </div>
      )}

      {/* ── Review body ── */}
      <div className="px-6 py-5 flex-1 flex flex-col">
        {showSkeleton ? (
          <div className="space-y-2.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="shimmer h-3 rounded" style={{ width: `${96 - i * 18}%` }} />
            ))}
          </div>
        ) : error ? (
          <p className="text-[13px] text-red-500/90">{error}</p>
        ) : text ? (
          <p className="prose-review text-[13px] font-normal text-foreground leading-relaxed flex-1 whitespace-pre-wrap">
            {text.replace(/<br\s*\/?>/gi, "\n")}
          </p>
        ) : (
          <p className="text-[13px] font-normal text-foreground/40 italic">{loading ? "Generating…" : "No review yet."}</p>
        )}
      </div>

      {/* ── Themes & sentiment footer ── */}
      {hasDetails && text && (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center justify-between w-full px-6 py-3 text-left hover:bg-surface-2/50 transition group"
          >
            <span className="text-[11px] font-semibold uppercase tracking-widest text-foreground/40 group-hover:text-foreground/70 transition">
              Themes &amp; sentiment
            </span>
            <span className={`transition-all text-[9px] text-foreground/30 group-hover:text-foreground/50 ${detailsOpen ? "rotate-180" : ""}`}>▼</span>
          </button>
          {detailsOpen && (
            <div className="px-6 pb-6 pt-4 border-t border-border/50 space-y-4">

              {/* Sentiment pill */}
              {sentiment && (
                <div className="flex items-center gap-2.5">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground/40 w-16 shrink-0">Sentiment</span>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize
                    ${sentiment === "Positive" ? "bg-real/15 text-real" :
                      sentiment === "Negative" ? "bg-red-500/10 text-red-500" :
                      "bg-surface-3 text-foreground/60"}`}>
                    {sentiment}
                  </span>
                </div>
              )}

              {/* Theme chips with score bars */}
              {themeEntries.length > 0 && (
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground/40 block mb-2.5">Themes</span>
                  <ul className="space-y-2">
                    {themeEntries.map(([theme, value]) => (
                      <li key={theme} className="flex items-center gap-3">
                        <span className="text-[12px] font-normal text-foreground truncate flex-1" title={theme}>{theme}</span>
                        {value !== 1 && (
                          <span className="text-[12px] font-bold text-foreground tabular-nums shrink-0">{value.toFixed(2)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
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
