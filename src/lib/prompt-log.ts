import type { HistoryContextItem } from "./types";
import type { Product, Tribe, User } from "./master";
import { formatUserCharacteristics } from "./user-characteristics";

/** Structured log for Vercel/server logs — search for `[sapiens-prompt]`. */
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
        productDescription: item.productDescription?.slice(0, 80) ?? "",
        reviewCharLength: item.reviewText.length,
        preview: item.reviewText.slice(0, 200),
      })),
    },
    section4: {
      hasBestPredictionReference,
      referenceCharLength: product?.bestPredictionReview?.length ?? 0,
    },
    promptCharLength: promptCharLength ?? null,
  };

  console.log("[sapiens-prompt]", JSON.stringify(payload, null, 2));
}
