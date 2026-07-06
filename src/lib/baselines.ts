/** Baseline configuration aligned with Clustering/baseline_mode_names.py */

export const BASELINE_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-8",
  "gpt-5",
  "gpt-5.2",
  "gpt-5.5",
] as const;

export type BaselineModel = (typeof BASELINE_MODELS)[number];

export const BASELINE_METHODS = [
  "history",
  "tribe_persona",
  "population_persona",
] as const;

export type BaselineMethod = (typeof BASELINE_METHODS)[number];

/** Fixed Sapiens model — matches amazon_sgo_pipeline_config.yaml gen_model */
export const SAPIENS_MODEL = "openai/gpt-5.2";

export const BASELINE_METHOD_META: Record<
  BaselineMethod,
  { label: string; tone: "history" | "persona" }
> = {
  history: {
    label: "History baseline",
    tone: "history",
  },
  tribe_persona: {
    label: "Tribe persona baseline",
    tone: "persona",
  },
  population_persona: {
    label: "Population persona baseline",
    tone: "persona",
  },
};

/** Map pipeline model slug → Vercel AI Gateway model id */
export function toGatewayModel(slug: string): string {
  if (slug.includes("/")) return slug;
  if (slug.startsWith("claude-")) return `anthropic/${slug}`;
  if (slug.startsWith("gpt-") || slug === "o3" || slug.startsWith("o4"))
    return `openai/${slug}`;
  return slug;
}

export function baselineLabel(method: BaselineMethod, model: BaselineModel): string {
  const m = BASELINE_METHOD_META[method].label;
  return `${m} · ${model}`;
}
