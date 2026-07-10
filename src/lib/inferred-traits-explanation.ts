import { hasGatewayKey, runModel } from "./ai";
import { mapCategoryToMain } from "./category-themes";
import type { Tribe, User } from "./master";
import { formatUserCharacteristics } from "./user-characteristics";
import type {
  InferredTraitInfluence,
  InferredTraitInfluencesResult,
  Qualitative,
} from "./types";
import { TRAIT_GROUP_LABELS } from "./types";

export const INFERRED_TRAITS_MODEL = "openai/gpt-4o-mini";
/** Minimum confidence to show a trait proof in the UI. */
export const INFERRED_TRAIT_UI_MIN_CONFIDENCE = 0.75;

type TraitCatalogEntry = {
  trait: string;
  source: "tribe" | "user";
  traitGroup?: string;
};

function nonEmptyTraits(items: string[]): string[] {
  return items.map((s) => s.trim()).filter(Boolean);
}

function firstSentence(text: string, maxLen = 160): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^[^.!?]+[.!?]?/);
  const sentence = (match?.[0] ?? trimmed).trim();
  if (sentence.length <= maxLen) return sentence;
  return `${sentence.slice(0, maxLen - 1).trim()}…`;
}

function formatTribeTraitCatalog(q: Qualitative): string {
  const sections: string[] = [];
  const add = (title: string, items: string[]) => {
    const filtered = nonEmptyTraits(items);
    if (filtered.length) {
      sections.push(
        `${title}:\n${filtered.map((trait, i) => `  ${i + 1}. ${trait}`).join("\n")}`,
      );
    }
  };
  add(TRAIT_GROUP_LABELS.inherentBehavioralTraits, q.inherentBehavioralTraits);
  add(TRAIT_GROUP_LABELS.latentMotivations, q.latentMotivations);
  add(TRAIT_GROUP_LABELS.validationTriggers, q.validationTriggers);
  add(TRAIT_GROUP_LABELS.frictionPoints, q.frictionPoints);
  add(TRAIT_GROUP_LABELS.implicitGoals, q.implicitGoals);
  return sections.join("\n\n");
}

function buildTraitCatalog(
  tribe: Tribe,
  user: User,
  category: string,
): { tribeBlock: string; userBlock: string; catalog: TraitCatalogEntry[] } {
  const catalog: TraitCatalogEntry[] = [];

  for (const [groupKey, label] of Object.entries(TRAIT_GROUP_LABELS) as Array<
    [keyof Qualitative, string]
  >) {
    for (const trait of nonEmptyTraits(tribe.qualitative[groupKey])) {
      catalog.push({ trait, source: "tribe", traitGroup: label });
    }
  }

  const userBlock = formatUserCharacteristics(user, category);
  const main = mapCategoryToMain(category);
  const categoryTrait = user.categoryCharacteristics?.[main]?.trim();
  const userSummary = user.characteristicSummary?.trim();

  if (userSummary) {
    catalog.push({
      trait: firstSentence(userSummary, 160),
      source: "user",
      traitGroup: "User traits (general)",
    });
  }
  if (categoryTrait) {
    catalog.push({
      trait: firstSentence(categoryTrait, 180),
      source: "user",
      traitGroup: "User traits (category)",
    });
  }

  return {
    tribeBlock: formatTribeTraitCatalog(tribe.qualitative),
    userBlock,
    catalog,
  };
}

function parseInferenceJson(raw: string): InferredTraitInfluencesResult | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      summary?: string;
      influences?: InferredTraitInfluence[];
    };
    if (!Array.isArray(parsed.influences)) return null;
    return {
      summary: String(parsed.summary ?? "").trim(),
      influences: parsed.influences,
    };
  } catch {
    return null;
  }
}

function normalizeTraitKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function resolveCatalogEntry(
  trait: string,
  catalog: TraitCatalogEntry[],
): TraitCatalogEntry | null {
  const key = normalizeTraitKey(trait);
  return (
    catalog.find((entry) => normalizeTraitKey(entry.trait) === key) ??
    catalog.find(
      (entry) =>
        normalizeTraitKey(entry.trait).includes(key) ||
        key.includes(normalizeTraitKey(entry.trait)),
    ) ??
    null
  );
}

function evidenceSupportedByReview(evidence: string, review: string): boolean {
  const ev = evidence.trim().toLowerCase();
  const rv = review.trim().toLowerCase();
  if (!ev || !rv) return false;
  if (rv.includes(ev)) return true;

  const words = ev.match(/[a-z0-9']{4,}/gi) ?? [];
  if (!words.length) return false;
  const matched = words.filter((word) => rv.includes(word.toLowerCase()));
  return matched.length >= Math.min(2, words.length);
}

function clampConfidence(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.65;
  return Math.max(0, Math.min(1, num));
}

function sanitizeInfluences(
  influences: InferredTraitInfluence[],
  catalog: TraitCatalogEntry[],
): InferredTraitInfluence[] {
  const seen = new Set<string>();
  const cleaned: InferredTraitInfluence[] = [];

  for (const item of influences) {
    const trait = String(item.trait ?? "").trim();
    const evidence = String(item.evidence ?? "").trim();
    const confidence = clampConfidence(item.confidence);
    if (!trait || !evidence || confidence < 0.6) continue;

    const match = resolveCatalogEntry(trait, catalog);
    if (!match) continue;

    const dedupeKey = `${match.source}:${normalizeTraitKey(match.trait)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    cleaned.push({
      trait: match.trait,
      source: match.source,
      traitGroup: match.traitGroup,
      evidence,
      confidence: Math.round(confidence * 100) / 100,
    });
  }

  return cleaned.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

function shortTraitLabel(trait: string): string {
  const trimmed = trait.trim();
  if (trimmed.length <= 72) return trimmed;
  return `${trimmed.slice(0, 69).trim()}…`;
}

/** Insert tribe name before the first "tribe" mention in a summary (post-processing, not LLM). */
export function injectTribeNameInSummary(summary: string, tribeName: string): string {
  const name = tribeName.trim();
  const text = summary.trim();
  if (!name || !text) return summary;

  const match = /\btribe\b/i.exec(text);
  if (!match || match.index === undefined) return summary;

  const idx = match.index;
  const before = text.slice(0, idx).trimEnd();
  if (
    before.endsWith(name) ||
    before.toLowerCase().endsWith(name.toLowerCase())
  ) {
    return summary;
  }

  const prefix = before.length ? `${before} ` : "";
  return `${prefix}${name} ${text.slice(idx)}`;
}

function buildFallbackSummary(
  influences: InferredTraitInfluence[],
  tribeName: string,
): string {
  if (!influences.length) {
    return injectTribeNameInSummary(
      "Tribe traits and user traits shaped what this review emphasizes — " +
        "which product points get airtime, how strongly they're rated, and the overall tone.",
      tribeName,
    );
  }

  const tribeHits = influences.filter((item) => item.source === "tribe");
  const userHits = influences.filter((item) => item.source === "user");
  const top = influences[0];

  const parts: string[] = [];
  if (tribeHits.length) {
    parts.push(
      `tribe traits around ${shortTraitLabel(tribeHits[0].trait).toLowerCase()} steer the review toward matching priorities`,
    );
  }
  if (userHits.length) {
    parts.push(
      `user traits around ${shortTraitLabel(userHits[0].trait).toLowerCase()} sharpen tone and emphasis`,
    );
  }
  const joined = parts.length ? parts.join(", while ") : "known persona traits steer the review's focus";

  return injectTribeNameInSummary(
    `${joined.charAt(0).toUpperCase()}${joined.slice(1)}. ` +
      `The clearest influence (${Math.round(top.confidence * 100)}% confidence) is ${shortTraitLabel(top.trait).toLowerCase()}, ` +
      `which shows up directly in what the review chooses to praise or criticize.`,
    tribeName,
  );
}

function sanitizeSummary(
  summary: string,
  influences: InferredTraitInfluence[],
  tribeName: string,
): string {
  const cleaned = summary.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length < 80) {
    return buildFallbackSummary(influences, tribeName);
  }
  return injectTribeNameInSummary(cleaned, tribeName);
}

function fallbackInfluences(
  sapiensReview: string,
  catalog: TraitCatalogEntry[],
): InferredTraitInfluence[] {
  const review = sapiensReview.toLowerCase();
  const hits: InferredTraitInfluence[] = [];

  for (const entry of catalog) {
    const words = entry.trait
      .toLowerCase()
      .match(/[a-z]{5,}/g)
      ?.slice(0, 8) ?? [];
    const matched = words.filter((word) => review.includes(word));
    if (matched.length < 2) continue;

    hits.push({
      trait: entry.trait,
      source: entry.source,
      traitGroup: entry.traitGroup,
      evidence: `The review's focus and wording reflect this trait — especially around ${matched.slice(0, 3).join(", ")}.`,
      confidence: Math.min(0.72, 0.45 + matched.length * 0.08),
    });
    if (hits.length >= 3) break;
  }

  return hits;
}

function buildInferencePrompt(args: {
  tribeName: string;
  tribeBlock: string;
  userBlock: string;
  sapiensReview: string;
}): { system: string; prompt: string } {
  const system =
    "You identify which known tribe and user traits shaped a generated product review's opinion. " +
    "Explain influence causally — what traits pulled the review toward certain priorities, tone, and emphasis. " +
    "Use ONLY traits from the provided lists. Every inference must cite concrete evidence from the review. " +
    "Assign honest confidence scores. Do not invent traits. Do not reference ground-truth reviews or user norms. Output only JSON.";

  const prompt = `Tribe: ${args.tribeName}

TRIBE TRAITS (choose only from this list):
${args.tribeBlock || "(none)"}

USER TRAITS (choose only from this list):
${args.userBlock}

SAPIENS GENERATED REVIEW:
${args.sapiensReview}

Return JSON exactly:
{
  "summary": "<2-3 sentence client-facing explanation>",
  "influences": [
    {
      "trait": "<exact trait text from the lists above>",
      "source": "tribe" | "user",
      "traitGroup": "<tribe group label if tribe trait; User traits (general) or User traits (category) if user trait>",
      "evidence": "<short explanation of how this trait shows up in the review — what the review emphasizes and why that reflects the trait>",
      "confidence": <number 0.0-1.0>
    }
  ]
}

Summary rules (this is the main narrative the client reads):
- Write 2-3 sentences explaining HOW tribe traits and user traits influenced this review's opinion — not how SAPIENS works.
- Only mention traits that clearly helped shape the review. Omit any trait that did not materially influence the opinion.
- The summary must only discuss traits you include in the influences list — do not name extra traits.
- Describe causally: because tribe traits prioritize X, the review emphasizes Y; because user traits emphasize Z, the tone/focus shifts toward W.
- Always say "tribe traits" and "user traits" — never "the user", "this user", or "the reviewer" when referring to persona traits.
- Do NOT say "SAPIENS analyzes", "through the lens of", or repeat the tribe name as a label.
- Do NOT describe the inference process or methodology.
- Do NOT use bullet points.

Influence + confidence rules:
- Include only traits that clearly helped shape the review — quality over quantity (typically 2-4).
- Omit weak, tangential, or non-contributing traits entirely (do not list them).
- evidence should explain HOW the trait influenced the review — what the review emphasizes, praises, or criticizes, and why that reflects this trait. Ground it in the review but write analytically, not as a bare quote.
- In evidence, say "tribe traits" or "user traits" — not "the user".
- confidence guide:
  - 0.85-1.0 = trait clearly drives a major theme in the review
  - 0.65-0.84 = trait strongly visible in tone or focus
  - below 0.65 = do not include
- Prefer a mix of tribe traits + user traits when both clearly contributed.
- User traits may include both general (cross-category) and category-specific entries — pick the one that best matches the review.
- Skip traits with no support in the review.`;

  return { system, prompt };
}

/** Infer which provided user/tribe traits shaped a SAPIENS review (no GT review or user norms). */
export async function generateInferredTraitInfluences(args: {
  sapiensReview: string;
  tribe: Tribe;
  user: User;
  category: string;
}): Promise<InferredTraitInfluencesResult | null> {
  const review = args.sapiensReview.trim();
  if (!review) return null;

  const { tribeBlock, userBlock, catalog } = buildTraitCatalog(
    args.tribe,
    args.user,
    args.category,
  );
  if (!catalog.length) return null;

  if (!hasGatewayKey()) {
    const influences = fallbackInfluences(review, catalog);
    if (!influences.length) return null;
    return {
      summary: buildFallbackSummary(influences, args.tribe.name),
      influences,
    };
  }

  const { system, prompt } = buildInferencePrompt({
    tribeName: args.tribe.name,
    tribeBlock,
    userBlock,
    sapiensReview: review,
  });

  try {
    const raw = await runModel({
      model: INFERRED_TRAITS_MODEL,
      system,
      prompt,
      temperature: 0.2,
    });
    const parsed = parseInferenceJson(raw);
    if (!parsed?.influences?.length) {
      const influences = fallbackInfluences(review, catalog);
      if (!influences.length) return null;
      return {
        summary: buildFallbackSummary(influences, args.tribe.name),
        influences,
      };
    }

    const cleaned = sanitizeInfluences(parsed.influences, catalog);
    const influences = cleaned.length ? cleaned : fallbackInfluences(review, catalog);
    if (!influences.length) return null;

    return {
      summary: sanitizeSummary(parsed.summary, influences, args.tribe.name),
      influences,
    };
  } catch {
    const influences = fallbackInfluences(review, catalog);
    if (!influences.length) return null;
    return {
      summary: buildFallbackSummary(influences, args.tribe.name),
      influences,
    };
  }
}
