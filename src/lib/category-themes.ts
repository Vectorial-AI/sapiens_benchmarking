import categoryMappingJson from "@/data/category-mapping.json";
import categoryThemesJson from "@/data/category-themes.json";
import { DEFAULT_THEMES } from "./prompts-constants";
import { normalizeThemeName, themeTopKFromGroundTruth } from "./scoring";

type CategoryThemes = Record<string, string[]>;

const categoryThemes = categoryThemesJson as CategoryThemes;
const categoryToMain =
  (categoryMappingJson as { category_to_main_mapping?: Record<string, string> })
    .category_to_main_mapping ?? {};

/** Map product subcategory to one of 7 main categories. */
export function mapCategoryToMain(category: string): string {
  const c = category.trim();
  if (!c) return "Health & Personal Care";
  return categoryToMain[c] ?? c;
}

/** Themes for prompt context — from category_themes.json, never ground-truth topics. */
export function getCategoryThemes(category: string): string[] {
  const main = mapCategoryToMain(category);
  const themes = categoryThemes[main];
  return themes?.length ? themes : DEFAULT_THEMES;
}

function themeMatchesGroundTruth(theme: string, groundTruthThemes: string[]): boolean {
  const norm = normalizeThemeName(theme);
  if (!norm) return false;
  for (const gt of groundTruthThemes) {
    const g = normalizeThemeName(gt);
    if (!g) continue;
    if (norm === g || norm.includes(g) || g.includes(norm)) return true;
  }
  return false;
}

/**
 * Baseline prompts: omit ground-truth themes from the category checklist.
 * - k=1: remove all GT themes that appear in the category list
 * - k=2: remove one GT theme from the category list
 */
export function getCategoryThemesForBaselinePrompt(
  category: string,
  groundTruthThemes: string[] = [],
): string[] {
  const themes = getCategoryThemes(category);
  const k = themeTopKFromGroundTruth(groundTruthThemes);
  if (k <= 0) return themes;

  if (k === 1) {
    const filtered = themes.filter((t) => !themeMatchesGroundTruth(t, groundTruthThemes));
    return filtered.length ? filtered : themes;
  }

  if (k === 2) {
    let removed = 0;
    const filtered = themes.filter((t) => {
      if (removed >= 1) return true;
      if (themeMatchesGroundTruth(t, groundTruthThemes)) {
        removed++;
        return false;
      }
      return true;
    });
    return filtered.length ? filtered : themes;
  }

  return themes;
}
