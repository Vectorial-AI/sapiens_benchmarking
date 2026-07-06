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
  { label: string; blurb: string; tone: "history" | "persona" }
> = {
  history: {
    label: "History baseline",
    blurb: "User's past reviews as style context (leave-one-out)",
    tone: "history",
  },
  tribe_persona: {
    label: "Tribe persona baseline",
    blurb: "Per-micro definition from micro_cluster_tribe_definitions.json",
    tone: "persona",
  },
  population_persona: {
    label: "Population persona baseline",
    blurb: "Category definition from category_generic_tribe_definitions.json",
    tone: "persona",
  },
};

/** Source files and field mapping for each baseline prompt. */
export const BASELINE_DATA_SOURCES: Record<BaselineMethod, string> = {
  history: "Clustering/prediction_micro_cluster_history.py (leave-one-out user reviews)",
  tribe_persona: "Clustering/micro_cluster_tribe_definitions.json",
  population_persona: "Clustering/category_generic_tribe_definitions.json",
};

/** What each baseline method actually receives in the prompt (for UI transparency). */
export const BASELINE_CONTEXT: Record<
  BaselineMethod,
  { includes: string[]; excludes: string[]; whyStrong?: string }
> = {
  history: {
    includes: [
      "All of this user's other reviews (leave-one-out — held-out product excluded)",
      "Review text only in examples (style, tone, length, detail level)",
      "Target product description",
      "Category theme list for confidence scoring",
      "Tribe name as persona label",
    ],
    excludes: [
      "Sapiens evolved tribe traits",
      "Per-user characteristic summary",
      "Held-out ground-truth review",
      "micro_cluster_tribe_definitions.json persona paragraph",
    ],
    whyStrong:
      "Past reviews are a very direct style signal — the model mimics how this person actually writes. Often the strongest baseline on text similarity.",
  },
  tribe_persona: {
    includes: [
      "tribe_definition for this cluster/micro from micro_cluster_tribe_definitions.json",
      "Tribe name (persona_name)",
      "Product description + category",
      "Category theme list",
    ],
    excludes: [
      "Sapiens evolved traits from evolution_state.json",
      "User-specific characteristics",
      "Any review history",
    ],
    whyStrong:
      "Short seed persona per micro-cluster — no per-user tailoring, but gives a coherent group voice for theme scoring.",
  },
  population_persona: {
    includes: [
      "Generic category shopper definition from category_generic_tribe_definitions.json",
      "Group name: \"{category} shoppers\"",
      "Product description + category",
      "Category theme list",
    ],
    excludes: [
      "Tribe-specific micro_cluster_tribe_definitions.json entry",
      "Sapiens evolved traits",
      "User characteristics",
      "Review history",
    ],
    whyStrong:
      "Broadest persona — still gets product + theme rubric, so it can score well on themes; on a single review it can beat Sapiens by chance (e.g. sentiment match).",
  },
};

export const SAPIENS_CONTEXT = {
  includes: [
    "Evolved tribe traits (group summary + DO / DRIVE / triggers / frictions / goals)",
    "This user's characteristic summary",
    "Product description + category",
    "Category theme list",
    "Review length target from ground truth",
  ],
  excludes: [
    "Held-out ground-truth review text",
    "Other reviews by this user (leave-one-out history — not yet in UI port)",
  ],
  note: "Full Python i0 prompt also sends prior reviews as style context; UI port is traits + user chars only.",
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
