/** Client-safe types shared across the app. No server imports here. */

import type { BaselineMethod, BaselineModel } from "./baselines";

export type Qualitative = {
  inherentBehavioralTraits: string[];
  latentMotivations: string[];
  validationTriggers: string[];
  frictionPoints: string[];
  implicitGoals: string[];
};

export type CatalogProduct = {
  reviewKey: string;
  productDescription: string;
  mainProductDescription?: string;
  category: string;
  groundTruthThemes?: string[];
  groundTruthSentiment?: ReviewSentiment | null;
  healthcareBenchmark?: boolean;
  videoGamesBenchmark?: boolean;
  sapiensBaselineGap?: number;
  overallSimilarityScore?: number;
};

export type CatalogUser = {
  id: string;
  characteristicSummary: string;
  categoryCharacteristics?: Record<string, string>;
  similarityScore: number;
  products: CatalogProduct[];
};

export type DataSources = {
  users: string;
  products: string;
  similarity: string;
  traits: string;
};

export type CatalogTribeIndex = {
  id: string;
  name: string;
  cluster: string;
  microId: string;
  domain?: "healthcare" | "video_games";
  reviewCount?: number;
  description: string;
  userCount: number;
  traitSource: string;
  dataSources?: DataSources;
  traitCounts: {
    behavioral: number;
    motivations: number;
    triggers: number;
    friction: number;
    goals: number;
  };
  meanSimilarityScore?: number;
  meanSapiensBaselineGap?: number;
  deployCheckpoint?: string;
  deployIteration?: number;
  sapiensPromptMode?: string;
};

export type CatalogTribe = CatalogTribeIndex & {
  qualitative: Qualitative;
  tribeDefinition: string;
  populationDefinition: string;
  users: CatalogUser[];
  sapiensPromptMode?: string;
  deployCheckpoint?: string;
  deployIteration?: number;
};

export type HistoryContextItem = {
  reviewText: string;
};

export type ReviewSentiment = "Positive" | "Negative" | "Neutral";

export type PipelineMetrics = {
  recallAtK: number | null;
  textSimilarity: number | null;
  textDelta: number | null;
  sentimentMatch: number | null;
  overallSimilarityScore: number | null;
  isMatch: boolean | null;
};

export type EngineResult = {
  engine: "baseline" | "sapiens";
  reviewText: string;
  predictedThemes?: Record<string, number>;
  sentiment?: ReviewSentiment | null;
  metrics?: PipelineMetrics;
  /** Plain-language LLM summary of what overlaps or differs vs ground truth. */
  similarityExplanation?: string | null;
  model: string;
  latencyMs: number;
  error?: string;
};

/** A single baseline run, keyed by method + model. */
export type BaselineResult = EngineResult & {
  key: string;
  method: BaselineMethod;
  baselineModel: BaselineModel;
  historyContext?: HistoryContextItem[];
};

export type RunMode = "sapiens" | "baseline";

export type SapiensRunResponse = {
  groundTruth: string | null;
  groundTruthThemes?: string[];
  groundTruthSentiment?: ReviewSentiment | null;
  themeTopK?: number;
  sapiens: EngineResult;
  source: string;
  metricsSource?: "pipeline" | "mock";
};

export type BaselineRunResponse = {
  baseline: BaselineResult;
  themeTopK?: number;
  source: string;
  metricsSource?: "pipeline" | "mock";
};

export const TRAIT_GROUP_LABELS: Record<keyof Qualitative, string> = {
  inherentBehavioralTraits: "Inherent behavioral traits",
  latentMotivations: "Latent motivations",
  validationTriggers: "Validation triggers",
  frictionPoints: "Friction points",
  implicitGoals: "Implicit goals",
};
