import fs from "fs";
import path from "path";
import { getCategoryThemes } from "./category-themes";
import type { Qualitative, ReviewSentiment } from "./types";
import type { Product, Tribe, User } from "./master";
import { formatUserCharacteristics } from "./user-characteristics";
import { referenceReviewForLength, sapiensLengthConstraint, sapiensLengthConstraintFromText } from "./review-history";

const PROMPT_PATH = path.join(
  process.cwd(),
  "prompts/amazon/i0_initial_prediction_confidence_amazon.txt",
);

let cachedTemplate: string | null = null;

function loadTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  cachedTemplate = fs.readFileSync(PROMPT_PATH, "utf-8");
  return cachedTemplate;
}

function bullets(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none provided)";
}

function nonEmptyTraits(items: string[]): string[] {
  return items.map((s) => s.trim()).filter(Boolean);
}

function formatTribeTraitSections(q: Qualitative): Record<string, string> {
  const sections: Record<string, string> = {};
  const add = (key: string, title: string, items: string[]) => {
    const filtered = nonEmptyTraits(items);
    sections[key] = filtered.length
      ? filtered.map((i) => `- ${i}`).join("\n")
      : "(none)";
  };
  add("inherent_behavioral_traits", "DO", q.inherentBehavioralTraits);
  add("latent_motivations", "DRIVE", q.latentMotivations);
  add("validation_triggers", "Triggers", q.validationTriggers);
  add("friction_points", "Friction", q.frictionPoints);
  add("implicit_goals", "Goals", q.implicitGoals);
  return sections;
}

function formatUserGapSection(gapContext: string): string {
  const text = gapContext.trim();
  if (!text) return "";
  return (
    "---\n" +
    "SECTION 2B: Review norms for this prediction (content guide — persona voice, not a script)\n\n" +
    "Follow these norms for **what** to cover. Write **as the persona** (Sections 1–3) for **how** you say it:\n" +
    "- **Norms → themes:** cover what these notes point to; omit what they say to skip.\n" +
    "- **Persona → voice:** first person, natural phrasing, match Section 3 length and tone.\n" +
    "- Same themes, different sentences — do not copy bullets or follow their order.\n" +
    "- Score themes by how much the review discusses each one; omitted themes stay low.\n\n" +
    `${text}\n`
  );
}

function formatLeaveOneOutHistory(product: Product | null): string {
  const rows = (product?.leaveOneOutHistoryReviews ?? [])
    .map((text) => text.trim())
    .filter(Boolean);
  if (!rows.length) return "(none available)";
  return rows
    .map((text, i) => {
      const clipped =
        text.length > 900 ? `${text.slice(0, 900).trimEnd()}…` : text;
      return `Example ${i + 1}:\n${clipped}`;
    })
    .join("\n\n");
}

const themesJson = (themes: string[]) =>
  themes.map((t) => `    ${JSON.stringify(t)}: 0.0`).join(",\n");

/** Video games / software blind deploy i2 — reference review + margin word cap. */
export function buildBlindDeployI2Prompt(args: {
  tribe: Tribe;
  user: User;
  product: Product | null;
  productDescription: string;
  category: string;
  groundTruthThemes?: string[];
  groundTruthSentiment?: ReviewSentiment | null;
}): string {
  const {
    tribe,
    user,
    product,
    productDescription,
    category,
    groundTruthSentiment,
  } = args;
  const template = loadTemplate();
  const themes = getCategoryThemes(category);
  const traits = formatTribeTraitSections(tribe.qualitative);
  const userChar = formatUserCharacteristics(user, category);
  const userGapSection = formatUserGapSection(product?.userNormContext ?? "");
  const leaveOneOut = formatLeaveOneOutHistory(product);
  const lengthReference =
    product?.groundTruthReview?.trim() ||
    referenceReviewForLength(product);
  const lengthConstraint =
    sapiensLengthConstraint(product) ??
    sapiensLengthConstraintFromText(lengthReference) ??
    250 + 10;

  let prompt = template
    .replaceAll("{persona_name}", tribe.name)
    .replaceAll("{inherent_behavioral_traits}", traits.inherent_behavioral_traits)
    .replaceAll("{latent_motivations}", traits.latent_motivations)
    .replaceAll("{validation_triggers}", traits.validation_triggers)
    .replaceAll("{friction_points}", traits.friction_points)
    .replaceAll("{implicit_goals}", traits.implicit_goals)
    .replaceAll("{user_char_summary}", userChar.trim() || "(none)")
    .replaceAll("{user_gap_section}", userGapSection)
    .replaceAll("{leave_one_out_review_history}", leaveOneOut)
    .replaceAll("{product_description}", productDescription)
    .replaceAll("{category}", category)
    .replaceAll("{themes_list}", bullets(themes))
    .replaceAll("{length_constraint}", String(lengthConstraint));

  if (groundTruthSentiment) {
    prompt += `\n\nExpected overall sentiment for this review: **${groundTruthSentiment}**. Match it in review_text and the JSON sentiment field.`;
  }

  return prompt;
}
