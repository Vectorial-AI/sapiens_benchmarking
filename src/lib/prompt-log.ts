import type { BaselineMethod } from "./baselines";
import type { HistoryContextItem } from "./types";
import type { Product, Tribe, User } from "./master";
import { formatUserCharacteristics } from "./user-characteristics";

const PROMPT_LOG_CHUNK = 12_000;

/** Full prompt body — search Vercel logs for `[prompt-full:sapiens]` etc. */
export function logFullPrompt(
  tag: string,
  prompt: string,
  meta: Record<string, unknown>,
): void {
  console.log(`[prompt-full:${tag}] meta ${JSON.stringify(meta)}`);
  if (!prompt.length) {
    console.log(`[prompt-full:${tag}] (empty prompt)`);
    return;
  }
  const parts = Math.ceil(prompt.length / PROMPT_LOG_CHUNK);
  for (let i = 0; i < parts; i++) {
    const chunk = prompt.slice(i * PROMPT_LOG_CHUNK, (i + 1) * PROMPT_LOG_CHUNK);
    console.log(`[prompt-full:${tag}] part ${i + 1}/${parts}\n${chunk}`);
  }
  console.log(`[prompt-full:${tag}] end charLength=${prompt.length}`);
}

/** Structured summary — search for `[sapiens-prompt]`. */
export function logSapiensPromptContext(args: {
  tribeId: string;
  userId: string;
  reviewKey?: string;
  category: string;
  tribe: Tribe;
  user: User;
  product: Product | null;
  historyItems: HistoryContextItem[];
  hasBestPredictionReference: boolean;
  promptCharLength?: number;
  mode: "sapiens" | "mock";
}): void {
  const {
    tribeId,
    userId,
    reviewKey,
    category,
    tribe,
    user,
    product,
    historyItems,
    hasBestPredictionReference,
    promptCharLength,
    mode,
  } = args;

  const section2 = formatUserCharacteristics(user, category);
  const q = tribe.qualitative;

  const payload = {
    tag: "sapiens-prompt",
    tribeId,
    userId,
    reviewKey: reviewKey ?? null,
    category,
    mode,
    checklist: {
      section1TribeTraits:
        q.inherentBehavioralTraits.length > 0 || q.latentMotivations.length > 0,
      section2UserCharacteristics:
        section2.trim() !== "" && section2 !== "(none)",
      section3PriorReviews: historyItems.length > 0,
      section4SgoReference: hasBestPredictionReference,
    },
    section1: {
      tribeName: tribe.name,
      behavioralTraits: q.inherentBehavioralTraits.length,
      motivations: q.latentMotivations.length,
    },
    section2: {
      charLength: section2.length,
      preview: section2.slice(0, 400),
    },
    section3: {
      count: historyItems.length,
      reviews: historyItems.map((item, i) => ({
        index: i + 1,
        reviewCharLength: item.reviewText.length,
        preview: item.reviewText.slice(0, 200),
      })),
    },
    section4: {
      hasBestPredictionReference,
      referenceCharLength: product?.bestPredictionReview?.length ?? 0,
    },
    promptCharLength: promptCharLength ?? null,
    fullPromptLogTags: [
      "prompt-full:system",
      "prompt-full:sapiens",
      "prompt-full:baseline:history",
      "prompt-full:baseline:tribe_persona",
      "prompt-full:baseline:population_persona",
    ],
  };

  console.log("[sapiens-prompt]", JSON.stringify(payload, null, 2));
}

export function logBaselinePromptFull(args: {
  method: BaselineMethod;
  tribeId: string;
  userId: string;
  reviewKey?: string;
  prompt: string;
  model?: string;
}): void {
  logFullPrompt(`baseline:${args.method}`, args.prompt, {
    tribeId: args.tribeId,
    userId: args.userId,
    reviewKey: args.reviewKey ?? null,
    method: args.method,
    model: args.model ?? null,
  });
}
