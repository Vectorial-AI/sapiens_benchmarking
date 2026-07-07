import type { BaselineMethod } from "./baselines";
import type { HistoryContextItem } from "./types";
import type { Tribe, User } from "./master";

/** Prompt logging disabled. */
export function logFullPrompt(
  _tag: string,
  _prompt: string,
  _meta: Record<string, unknown>,
): void {}

/** Prompt logging disabled. */
export function logSapiensPromptContext(_args: {
  tribeId: string;
  userId: string;
  reviewKey?: string;
  category: string;
  tribe: Tribe;
  user: User;
  historyItems: HistoryContextItem[];
  promptCharLength?: number;
  mode: "sapiens" | "mock";
}): void {}

/** Prompt logging disabled. */
export function logBaselinePromptFull(_args: {
  method: BaselineMethod;
  tribeId: string;
  userId: string;
  reviewKey?: string;
  prompt: string;
  model?: string;
}): void {}
