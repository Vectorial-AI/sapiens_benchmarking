import type { BaselineMethod } from "./baselines";
import type { HistoryContextItem } from "./types";
import type { Tribe, User } from "./master";
import { formatUserCharacteristics } from "./user-characteristics";

const PROMPT_LOG_CHUNK = 12_000;

function nonEmptyTraits(items: string[]): string[] {
  return items.map((s) => s.trim()).filter(Boolean);
}

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
  historyItems: HistoryContextItem[];
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
    historyItems,
    promptCharLength,
    mode,
  } = args;

  const userCharacteristics = formatUserCharacteristics(user, category);
  const q = tribe.qualitative;

  const payload = {
    tag: "sapiens-prompt",
    tribeId,
    userId,
    reviewKey: reviewKey ?? null,
    category,
    mode,
    checklist: {
      tribeBehavioralTraits: nonEmptyTraits(q.inherentBehavioralTraits).length > 0,
      tribeMotivations: nonEmptyTraits(q.latentMotivations).length > 0,
      tribeValidationTriggers: nonEmptyTraits(q.validationTriggers).length > 0,
      tribeFrictionPoints: nonEmptyTraits(q.frictionPoints).length > 0,
      tribeImplicitGoals: nonEmptyTraits(q.implicitGoals).length > 0,
      userCharacteristics:
        userCharacteristics.trim() !== "" && userCharacteristics !== "(none)",
      priorReviews: historyItems.length > 0,
    },
    tribeName: tribe.name,
    tribeTraits: {
      behavioralTraits: nonEmptyTraits(q.inherentBehavioralTraits).length,
      motivations: nonEmptyTraits(q.latentMotivations).length,
      validationTriggers: nonEmptyTraits(q.validationTriggers).length,
      frictionPoints: nonEmptyTraits(q.frictionPoints).length,
      implicitGoals: nonEmptyTraits(q.implicitGoals).length,
    },
    userCharacteristics: {
      charLength: userCharacteristics.length,
      preview: userCharacteristics.slice(0, 400),
    },
    priorReviews: {
      count: historyItems.length,
      reviews: historyItems.map((item, i) => ({
        index: i + 1,
        reviewCharLength: item.reviewText.length,
        preview: item.reviewText.slice(0, 200),
      })),
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
