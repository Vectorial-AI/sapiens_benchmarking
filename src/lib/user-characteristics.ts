import { mapCategoryToMain } from "./category-themes";
import type { User } from "./master";

/** Format user characteristics like amazon_data_adapters.get_user_characteristics_for_review */
export function formatUserCharacteristics(user: User, category: string): string {
  const lines: string[] = [];
  const general = user.characteristicSummary?.trim();
  if (general) {
    lines.push(`[General Characteristics] ${general}`);
  }
  const main = mapCategoryToMain(category);
  const catChar = user.categoryCharacteristics?.[main]?.trim();
  if (catChar) {
    lines.push(`[${main} Specific] ${catChar}`);
  }
  return lines.length ? lines.join("\n\n") : "(none)";
}
