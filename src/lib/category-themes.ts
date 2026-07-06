import categoryMappingJson from "@/data/category-mapping.json";
import categoryThemesJson from "@/data/category-themes.json";
import { DEFAULT_THEMES } from "./prompts-constants";

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
