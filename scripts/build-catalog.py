#!/usr/bin/env python3
"""
Build catalog data for the Sapiens Benchmark UI.

Sources:
  - Tribe members/reviews: Clustering/micro_cluster_details/cluster_{N}/micro_{M}_details.json
  - Evolved traits (SGO):  outputs/amazon_sgo/cluster_4/micro_1|micro_7_best/evolution/evolution_state.json
                           outputs/amazon_sgo_health_care/cluster_4/micro_*/evolution/evolution_state.json
  - Tribe persona baseline: Clustering/micro_cluster_tribe_definitions.json (generate_tribe_definitions.py)
  - Population baseline:    Clustering/category_generic_tribe_definitions.json
  - User similarity scores: Clustering/Prediction_Accuracy_Refined/cluster_{N}/micro_{M}_summary_enhanced_delta_corrected.json
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

WORKSPACE = Path(__file__).resolve().parents[2]
CLUSTERING = WORKSPACE / "Clustering"
sys.path.insert(0, str(CLUSTERING))
from global_review_keys import (  # noqa: E402
    assert_products_have_global_keys,
    load_global_review_key_index,
    normalize_product_key,
    resolve_review_key,
)
OUTPUTS = WORKSPACE / "outputs"
DATA_EXTRACTION = WORKSPACE / "Data extraction"
OUT_DIR = Path(__file__).resolve().parents[1] / "src" / "data"
USER_CHARS_PATH = DATA_EXTRACTION / "user_llm_characteristics.json"
CATEGORY_MAPPING_PATH = DATA_EXTRACTION / "category_mapping_to_7_main.json"
HEALTHCARE_ACCURACY_PATH = (
    CLUSTERING / "Prediction_Accuracy_Refined" / "healthcare_digital_technical_accuracy.json"
)
VIDEO_GAMES_PERFORMANCE_PATH = (
    CLUSTERING / "Prediction_Accuracy_Refined" / "video_games_tribe_performance.json"
)
HIST_BASELINE_DIR = CLUSTERING / "micro_cluster_history_predictions_health_care"
TRIBE_BASELINE_DIR = CLUSTERING / "micro_cluster_tribe_predictions_health_care"
HISTORY_GPT5_DIR = HIST_BASELINE_DIR / "gpt-5"
HISTORY_GPT5_FILTERED_CACHE = CLUSTERING / "_cache" / "gpt5_history_health_care_filtered.json"
BASELINE_MODELS = ["claude-sonnet-4-6", "claude-opus-4-8", "gpt-5", "gpt-5.2", "gpt-5.5"]

# Matches sapiens_benchmarking-main/src/lib/scoring.ts computePipelineMetrics
APP_WEIGHT_TEXT = 0.25
APP_WEIGHT_THEME = 0.7
APP_WEIGHT_SENTIMENT = 0.05

MIN_TRIBE_REVIEWS = 12
MIN_VG_TRIBE_REVIEWS = 25
TRIBES_PER_DOMAIN = 15
HEALTH_MAIN = "Health & Personal Care"
VIDEO_GAMES_MAIN = "Video Games"
SOFTWARE_MAIN = "Software"
# History baseline for healthcare: exclude target category and All Beauty from primary context.
HEALTHCARE_HISTORY_EXCLUDED_MAINS = frozenset({HEALTH_MAIN, "All Beauty"})
MAX_USER_HISTORY_REVIEWS = 6
HISTORY_WORST_FALLBACK_REVIEWS = 3
# Rank history · gpt-5 fallback candidates (worst = lowest score).
HISTORY_RANK_WEIGHT_TEXT = 0.3
HISTORY_RANK_WEIGHT_THEME = 0.7
# UI catalog: only healthcare reviews where Sapiens beats best baseline by >10pp.
MIN_UI_SAPIENS_BASELINE_GAP = 0.10
VIDEO_GAMES_BENCHMARK_CLUSTER = "cluster_0"
VIDEO_GAMES_BENCHMARK_MICRO = "micro_0"
VIDEO_GAMES_SOFTWARE_DETAILS_DIR = CLUSTERING / "micro_cluster_details_video_games_software"
VIDEO_GAMES_SOFTWARE_MAINS = frozenset({VIDEO_GAMES_MAIN, SOFTWARE_MAIN})
SAPIENS_VS_BASELINES_VG_PATH = (
    OUTPUTS / "amazon_sgo_health_care/cluster_0/micro_0/sapiens_vs_baselines_analysis.json"
)
BEST_DELTA_VG_PATH = OUTPUTS / "amazon_sgo_health_care/cluster_0/micro_0/best_delta_predictions.json"

SELECTED_TRIBES: list[tuple[str, str, str]] = []

POPULATION_DEFINITIONS = {
    "healthcare": (
        "Health-conscious consumers who evaluate supplements, personal care, and wellness products."
    ),
    "video_games": (
        "Gamers and software users who evaluate video games, mobile apps, and digital entertainment products."
    ),
}

# SGO review/user selection overrides (canonical benchmark sets)
SGO_REVIEW_SOURCES: dict[tuple[str, str], Path] = {
    ("cluster_4", "micro_1"): OUTPUTS / "amazon_sgo/cluster_4/micro_1/best_delta_predictions.json",
    ("cluster_4", "micro_7"): OUTPUTS
    / "amazon_sgo/cluster_4/micro_7_best/sapiens_vs_baselines_final_dataset.json",
}

# SGO evolution overrides (micro_7 uses micro_7_best)
EVOLUTION_OVERRIDES: dict[tuple[str, str], Path] = {
    ("cluster_4", "micro_1"): OUTPUTS / "amazon_sgo/cluster_4/micro_1/evolution/evolution_state.json",
    ("cluster_4", "micro_7"): OUTPUTS / "amazon_sgo/cluster_4/micro_7_best/evolution/evolution_state.json",
}


def load_json(path: Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def trait_texts(items: list | None) -> list[str]:
    if not items:
        return []
    out = []
    for item in items:
        if isinstance(item, str):
            out.append(item)
        elif isinstance(item, dict) and "text" in item:
            out.append(item["text"])
    return out


def normalize_evolution(ev: dict) -> dict:
    q = ev.get("qualitative_summary") or {}
    latent = q.get("latent_motivations") or {}
    latent_main = latent.get("main") if isinstance(latent, dict) else []
    return {
        "tribe_name": ev.get("persona_name", ""),
        "tribe_description": ev.get("group_summary", ""),
        "qualitative_summary": {
            "inherent_behavioral_traits": q.get("inherent_behavioral_traits") or [],
            "latent_motivations": {"main": latent_main or []},
            "validation_triggers": q.get("validation_triggers") or [],
            "friction_points": q.get("friction_points") or [],
            "implicit_goals": q.get("implicit_goals") or [],
        },
    }


def find_evolution(cluster: str, micro: str) -> dict | None:
    key = (cluster, micro)
    if key in EVOLUTION_OVERRIDES:
        p = EVOLUTION_OVERRIDES[key]
        if p.exists():
            return normalize_evolution(load_json(p))

    for base in ("amazon_sgo", "amazon_sgo_health_care"):
        p = OUTPUTS / base / cluster / micro / "evolution" / "evolution_state.json"
        if p.exists():
            return normalize_evolution(load_json(p))
    return None


def find_tribe_definition(definitions: list, cluster: str, micro: str) -> str:
    for d in definitions:
        if d.get("cluster") == cluster and d.get("micro_cluster_id") == micro:
            return d.get("tribe_definition", "")
    return ""


def tribe_persona_description(tribe_def: str, tribe_name: str) -> str:
    """Short tribe persona blurb (generate_tribe_definitions.py) — not evolved group_summary."""
    text = (tribe_def or "").strip()
    return text or tribe_name


def load_category_mapping() -> dict[str, str]:
    if not CATEGORY_MAPPING_PATH.exists():
        return {}
    data = load_json(CATEGORY_MAPPING_PATH)
    return data.get("category_to_main_mapping") or {}


def app_similarity_score(
    *,
    text_delta: float | None = None,
    text_similarity: float | None = None,
    recall: float | None = None,
    sentiment_match: float | None = None,
) -> float | None:
    """UI composite: 0.25*text + 0.7*recall@k + 0.05*sentiment (same weights as scoring.ts)."""
    parts: list[float] = []
    if text_similarity is not None:
        parts.append(float(text_similarity) * APP_WEIGHT_TEXT)
    elif text_delta is not None:
        parts.append(max(0.0, 1.0 - float(text_delta)) * APP_WEIGHT_TEXT)
    if recall is not None:
        parts.append(float(recall) * APP_WEIGHT_THEME)
    if sentiment_match is not None:
        parts.append(float(sentiment_match) * APP_WEIGHT_SENTIMENT)
    return round(sum(parts), 4) if parts else None


def history_fallback_rank_score(
    *,
    text_delta: float | None = None,
    text_similarity: float | None = None,
    recall: float | None = None,
) -> float | None:
    """0.3×text_similarity + 0.7×recall@k — rank history · gpt-5 fallback candidates."""
    parts: list[float] = []
    if text_similarity is not None:
        parts.append(HISTORY_RANK_WEIGHT_TEXT * float(text_similarity))
    elif text_delta is not None:
        parts.append(HISTORY_RANK_WEIGHT_TEXT * max(0.0, 1.0 - float(text_delta)))
    if recall is not None:
        parts.append(HISTORY_RANK_WEIGHT_THEME * float(recall))
    return round(sum(parts), 4) if parts else None


def load_video_games_app_scores() -> dict[str, float]:
    """review_key -> UI overall similarity from video_games_tribe_performance.json."""
    if not VIDEO_GAMES_PERFORMANCE_PATH.exists():
        return {}
    data = load_json(VIDEO_GAMES_PERFORMANCE_PATH)
    scores: dict[str, float] = {}
    for row in data.get("reviews") or []:
        rk = str(row.get("review_key") or "").strip()
        if not rk:
            continue
        score = app_similarity_score(
            text_delta=row.get("text_delta"),
            recall=row.get("recall"),
            sentiment_match=row.get("sentiment_score"),
        )
        if score is not None:
            scores[rk] = score
    return scores


def tribe_mean_similarity(tribe: dict) -> float:
    scores: list[float] = []
    grouped = tribe.get("members_grouped_by_user") or {}
    for prods in grouped.values():
        for p in prods:
            s = p.get("overall_similarity_score")
            if s is not None:
                scores.append(float(s))
    return round(sum(scores) / len(scores), 4) if scores else 0.0


def _baseline_join_key(user_id: str, product_description: str) -> tuple[str, str]:
    return (str(user_id), str(product_description).strip())


def _norm_baseline_sentiment(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in {"positive", "negative", "neutral"}:
        return text.capitalize()
    return None


def _baseline_sentiment_score(gt: Any, pred: Any) -> float | None:
    g, p = _norm_baseline_sentiment(gt), _norm_baseline_sentiment(pred)
    if not g:
        return None
    if not p:
        return 0.0
    return 1.0 if g == p else 0.0


def _baseline_overall_similarity(
    text_delta: float | None,
    recall_k: float | None,
    sent_score: float | None,
) -> float | None:
    if text_delta is None or recall_k is None:
        return None
    text_sim = max(0.0, 1.0 - float(text_delta))
    parts = [APP_WEIGHT_TEXT * text_sim, APP_WEIGHT_THEME * float(recall_k)]
    if sent_score is not None:
        parts.append(float(sent_score) * APP_WEIGHT_SENTIMENT)
    return round(sum(parts), 4)


def load_healthcare_sapiens_baseline_gaps(
    hc_entries: dict[str, dict],
    hc_scores: dict[str, float],
) -> dict[str, float]:
    """review_key -> (Sapiens ui score − best baseline score across all modes/models)."""
    gt_sent_by_join: dict[tuple[str, str], Any] = {}
    review_key_by_join: dict[tuple[str, str], str] = {}
    for review_key, entry in hc_entries.items():
        jk = _baseline_join_key(entry.get("user_id", ""), entry.get("product_description", ""))
        gt_sent_by_join[jk] = (entry.get("ground_truth") or {}).get("sentiment")
        review_key_by_join[jk] = review_key

    best_by_join: dict[tuple[str, str], float] = {}

    def ingest(paths: list[Path]) -> None:
        for path in paths:
            for entry in load_json(path).get("predictions") or []:
                jk = _baseline_join_key(
                    entry.get("user_id", ""),
                    entry.get("product_description", ""),
                )
                metrics = entry.get("metrics") or {}
                pred = entry.get("prediction") or {}
                score = _baseline_overall_similarity(
                    metrics.get("text_delta"),
                    metrics.get("recall@k"),
                    _baseline_sentiment_score(gt_sent_by_join.get(jk), pred.get("sentiment")),
                )
                if score is None:
                    continue
                best_by_join[jk] = max(best_by_join.get(jk, 0.0), score)

    for model in BASELINE_MODELS:
        ingest(sorted((HIST_BASELINE_DIR / model).glob("cluster_*/micro_*_confidence_history.json")))
        ingest(sorted((TRIBE_BASELINE_DIR / model).glob("cluster_*/micro_*_confidence_tribe.json")))
        ingest(
            sorted(
                (TRIBE_BASELINE_DIR / model).glob(
                    "cluster_*/micro_*_confidence_category_generic_tribe.json"
                )
            )
        )

    gaps: dict[str, float] = {}
    for jk, best_score in best_by_join.items():
        review_key = review_key_by_join.get(jk)
        if not review_key:
            continue
        sapiens_score = hc_scores.get(review_key)
        if sapiens_score is None:
            continue
        gaps[review_key] = round(float(sapiens_score) - float(best_score), 4)
    return gaps


def filter_healthcare_benchmark_by_gap(
    hc_by_tribe_user: dict[tuple[str, str], dict[str, list[dict]]],
    hc_scores: dict[str, float],
    hc_entries: dict[str, dict],
    hc_gaps: dict[str, float],
    *,
    min_gap: float = MIN_UI_SAPIENS_BASELINE_GAP,
) -> tuple[
    dict[tuple[str, str], dict[str, list[dict]]],
    dict[str, float],
    dict[str, dict],
    dict[str, float],
]:
    """Keep only reviews where Sapiens ui score exceeds best baseline by more than min_gap."""
    allowed = {review_key for review_key, gap in hc_gaps.items() if gap > min_gap}
    filtered_entries = {k: v for k, v in hc_entries.items() if k in allowed}
    filtered_scores = {k: v for k, v in hc_scores.items() if k in allowed}
    filtered_gaps = {k: v for k, v in hc_gaps.items() if k in allowed}

    filtered_by_tribe_user: dict[tuple[str, str], dict[str, list[dict]]] = {}
    for tribe_key, users in hc_by_tribe_user.items():
        tribe_users: dict[str, list[dict]] = {}
        for uid, reviews in users.items():
            kept = [r for r in reviews if r.get("review_key") in allowed]
            if kept:
                tribe_users[uid] = kept
        if tribe_users:
            filtered_by_tribe_user[tribe_key] = tribe_users

    return filtered_by_tribe_user, filtered_scores, filtered_entries, filtered_gaps


def load_video_games_sapiens_baseline_analysis() -> tuple[dict[str, float], dict[str, dict]]:
    """review_key -> gap; review_key -> analysis row from cluster_0/micro_0 comparison."""
    if not SAPIENS_VS_BASELINES_VG_PATH.is_file():
        return {}, {}
    data = load_json(SAPIENS_VS_BASELINES_VG_PATH)
    gaps: dict[str, float] = {}
    rows: dict[str, dict] = {}
    for row in data.get("reviews") or []:
        review_key = str(row.get("review_key") or "").strip()
        if not review_key:
            continue
        gap = row.get("gap_pp")
        if gap is None:
            continue
        gaps[review_key] = round(float(gap), 4)
        rows[review_key] = row
    return gaps, rows


def filter_video_games_benchmark_by_gap(
    vg_gaps: dict[str, float],
    vg_rows: dict[str, dict],
    *,
    min_gap: float = MIN_UI_SAPIENS_BASELINE_GAP,
) -> tuple[dict[str, float], dict[str, dict]]:
    allowed = {review_key for review_key, gap in vg_gaps.items() if gap > min_gap}
    return (
        {k: v for k, v in vg_gaps.items() if k in allowed},
        {k: v for k, v in vg_rows.items() if k in allowed},
    )


def load_healthcare_history_gpt5_prediction_index() -> tuple[
    dict[tuple[str, str, str], list[dict[str, Any]]],
    dict[str, list[dict[str, Any]]],
]:
    """history · gpt-5 predicted review texts + scores, keyed by (user_id, cluster, micro) and user_id."""

    def prediction_rank_score(row: dict) -> float:
        metrics = row.get("metrics") or {}
        score = history_fallback_rank_score(
            text_delta=metrics.get("text_delta"),
            recall=metrics.get("recall@k"),
        )
        return float(score) if score is not None else 0.0

    by_user_micro: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    by_user: dict[str, list[dict[str, Any]]] = {}

    def ingest_prediction(row: dict) -> None:
        user_id = str(row.get("user_id") or "").strip()
        if not user_id:
            return
        pred_text = str((row.get("prediction") or {}).get("review_text") or "").strip()
        if not pred_text:
            return
        product_description = str(row.get("product_description") or "").strip()
        cluster = str(row.get("cluster_name") or "").strip()
        micro = str(row.get("micro_cluster_id") or "").strip()
        item = {
            "product_description": product_description,
            "review_text": pred_text,
            "rank_score": prediction_rank_score(row),
        }
        if cluster and micro:
            by_user_micro.setdefault((user_id, cluster, micro), []).append(item)
        by_user.setdefault(user_id, []).append(item)

    if HISTORY_GPT5_DIR.is_dir():
        for path in sorted(HISTORY_GPT5_DIR.glob("cluster_*/micro_*_confidence_history.json")):
            for row in load_json(path).get("predictions") or []:
                ingest_prediction(row)

    if HISTORY_GPT5_FILTERED_CACHE.is_file():
        for row in load_json(HISTORY_GPT5_FILTERED_CACHE).get("predictions") or []:
            ingest_prediction(row)

    return by_user_micro, by_user


def history_gpt5_fallback_context(
    entry: dict,
    *,
    by_user_micro: dict[tuple[str, str, str], list[dict[str, Any]]],
    by_user: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """Precomputed worst 3 history · gpt-5 preds for this review (0.3×text + 0.7×theme rank)."""
    user_id = str(entry.get("user_id") or "").strip()
    cluster = str(entry.get("cluster_id") or "").strip()
    micro = str(entry.get("micro_id") or "").strip()
    target_desc = normalize_product_key(entry.get("product_description", ""))
    if not user_id or not target_desc:
        return []

    candidates: dict[str, dict[str, Any]] = {}

    def consider_item(item: dict[str, Any]) -> None:
        if normalize_product_key(item.get("product_description", "")) == target_desc:
            return
        text = str(item.get("review_text") or "").strip()
        if not text:
            return
        key = normalize_product_key(text)
        score = float(item.get("rank_score") or 0.0)
        existing = candidates.get(key)
        if existing is None or score < float(existing.get("rank_score") or 0.0):
            candidates[key] = {"review_text": text, "rank_score": round(score, 4)}

    for item in by_user_micro.get((user_id, cluster, micro), []):
        consider_item(item)
    for item in by_user.get(user_id, []):
        consider_item(item)

    worst = sorted(
        candidates.values(),
        key=lambda x: (float(x.get("rank_score") or 0.0), x.get("review_text", "")),
    )[:HISTORY_WORST_FALLBACK_REVIEWS]
    return worst


def tribe_mean_sapiens_baseline_gap(tribe: dict) -> float:
    gaps: list[float] = []
    grouped = tribe.get("members_grouped_by_user") or {}
    for prods in grouped.values():
        for product in prods:
            gap = product.get("sapiens_baseline_gap")
            if gap is not None:
                gaps.append(float(gap))
    return round(sum(gaps) / len(gaps), 4) if gaps else 0.0


def sort_products_by_sapiens_gap(products: list[dict]) -> list[dict]:
    return sorted(
        products,
        key=lambda p: (
            -float(p.get("sapiens_baseline_gap") or 0),
            str(p.get("review_key") or ""),
        ),
    )


def sort_users_by_sapiens_gap(users: list[dict]) -> list[dict]:
    def user_gap(user: dict) -> float:
        product_gaps = [
            float(p.get("sapiens_baseline_gap") or 0) for p in user.get("products") or []
        ]
        return max(product_gaps) if product_gaps else 0.0

    return sorted(
        users,
        key=lambda u: (-user_gap(u), str(u.get("user_id") or "")),
    )


def load_healthcare_benchmark_index() -> tuple[
    dict[tuple[str, str], dict[str, list[dict]]],
    dict[str, float],
    dict[str, dict],
]:
    """(cluster, micro) -> user_id -> reviews; review_key -> score; review_key -> entry."""
    if not HEALTHCARE_ACCURACY_PATH.exists():
        return {}, {}, {}

    data = load_json(HEALTHCARE_ACCURACY_PATH)
    key_to_tribe: dict[str, tuple[str, str]] = {}
    for row in data.get("metadata", {}).get("reviews_by_overall_similarity") or []:
        key_to_tribe[row["review_key"]] = (row["cluster_id"], row["micro_id"])

    by_tribe_user: dict[tuple[str, str], dict[str, list[dict]]] = {}
    scores: dict[str, float] = {}
    entries: dict[str, dict] = {}

    for review in data.get("reviews") or []:
        review_key = review.get("review_key")
        if not review_key:
            continue
        su = review.get("sgo_update") or {}
        cluster = review.get("cluster_id") or su.get("cluster_id")
        micro = review.get("micro_id") or su.get("micro_id")
        if not cluster or not micro:
            mapped = key_to_tribe.get(review_key)
            if mapped:
                cluster, micro = mapped
        if not cluster or not micro:
            continue

        tribe_key = (cluster, micro)
        uid = review["user_id"]
        by_tribe_user.setdefault(tribe_key, {}).setdefault(uid, []).append(review)

        acc = (review.get("accuracy") or {}).get("ui_overall_similarity")
        if acc is None:
            acc_block = review.get("accuracy") or {}
            acc = app_similarity_score(
                text_similarity=acc_block.get("text_similarity"),
                text_delta=acc_block.get("text_delta"),
                recall=acc_block.get("recall@k"),
                sentiment_match=acc_block.get("sentiment_score"),
            )
        if acc is not None:
            scores[review_key] = float(acc)
        entries[review_key] = review

    return by_tribe_user, scores, entries


def healthcare_product_from_entry(
    entry: dict,
    *,
    review_key: str,
    sapiens_baseline_gap: float | None = None,
    history_baseline_context_reviews: list[dict[str, Any]] | None = None,
) -> dict:
    """Digital healthcare benchmark: GT for scoring/display, user history for Sapiens context."""
    gt = entry.get("ground_truth") or {}
    pred = entry.get("prediction") or {}
    acc = entry.get("accuracy") or {}
    product: dict[str, Any] = {
        "review_key": review_key,
        "product_description": entry.get("product_description", ""),
        "review_text": gt.get("review", ""),
        "rating": gt.get("rating"),
        "category": entry.get("main_category", "Health & Personal Care"),
        "predicted_themes": gt.get("themes") or [],
        "sentiment": gt.get("sentiment"),
        "user_history_review": str(pred.get("review") or "").strip(),
        "user_history_themes": pred.get("themes") or [],
        "healthcare_benchmark": True,
    }
    score = acc.get("ui_overall_similarity")
    if score is None:
        score = app_similarity_score(
            text_similarity=acc.get("text_similarity"),
            text_delta=acc.get("text_delta"),
            recall=acc.get("recall@k"),
            sentiment_match=acc.get("sentiment_score"),
        )
    if score is not None:
        product["overall_similarity_score"] = float(score)
    if sapiens_baseline_gap is not None:
        product["sapiens_baseline_gap"] = float(sapiens_baseline_gap)
    if history_baseline_context_reviews:
        product["history_baseline_context_reviews"] = history_baseline_context_reviews
    sub = entry.get("major_subcategory_label")
    if sub:
        product["major_subcategory"] = sub
    return product


def video_games_benchmark_product_from_row(
    row: dict,
    *,
    review_key: str,
    sapiens_baseline_gap: float | None = None,
    analysis_row: dict | None = None,
) -> dict:
    """Video games + software benchmark: GT for display, Sapiens prediction as user history."""
    actual = row.get("actual") or {}
    prediction = row.get("prediction") or {}
    pred_themes = prediction.get("predicted_themes")
    if isinstance(pred_themes, dict):
        theme_names = [k for k, v in pred_themes.items() if float(v or 0) >= 0.5]
    else:
        theme_names = pred_themes or actual.get("predicted_themes") or []

    sapiens_score = None
    if analysis_row:
        sapiens_score = (analysis_row.get("sapiens") or {}).get("overall_similarity")

    product: dict[str, Any] = {
        "review_key": review_key,
        "product_description": row.get("product_description", ""),
        "review_text": actual.get("review_text") or actual.get("review") or "",
        "rating": actual.get("rating"),
        "category": row.get("category", VIDEO_GAMES_MAIN),
        "predicted_themes": actual.get("predicted_themes") or theme_names,
        "sentiment": actual.get("sentiment"),
        "user_history_review": str(prediction.get("review_text") or "").strip(),
        "user_history_themes": theme_names if isinstance(theme_names, list) else [],
        "best_prediction_review": str(prediction.get("review_text") or "").strip(),
        "video_games_benchmark": True,
    }
    if sapiens_score is not None:
        product["overall_similarity_score"] = round(float(sapiens_score), 4)
    if sapiens_baseline_gap is not None:
        product["sapiens_baseline_gap"] = float(sapiens_baseline_gap)
    if analysis_row and analysis_row.get("best_baseline"):
        bb = analysis_row["best_baseline"]
        product["best_baseline_method"] = bb.get("method")
        product["best_baseline_model"] = bb.get("model")
        if bb.get("overall_similarity") is not None:
            product["best_baseline_overall_similarity"] = float(bb["overall_similarity"])
    return product


def sort_user_products(
    products: list[dict],
    *,
    domain: str,
    priority_keys: set[str] | None = None,
    priority_scores: dict[str, float] | None = None,
    priority_descs: set[str] | None = None,
    sub_to_main: dict[str, str] | None = None,
) -> list[dict]:
    priority_keys = priority_keys or set()
    priority_scores = priority_scores or {}
    priority_descs = priority_descs or set()
    sub_to_main = sub_to_main or {}

    def is_priority(product: dict) -> bool:
        review_key = product.get("review_key", "")
        if review_key in priority_keys or product.get("healthcare_benchmark"):
            return True
        desc = normalize_product_key(product.get("product_description", ""))
        return desc in priority_descs

    def sort_key(product: dict) -> tuple:
        review_key = product.get("review_key", "")
        main = sub_to_main.get(product.get("category", ""), product.get("category", ""))
        if is_priority(product):
            desc = normalize_product_key(product.get("product_description", ""))
            score = priority_scores.get(review_key, 0.0)
            return (0, -score, review_key or desc)
        if main == VIDEO_GAMES_MAIN:
            return (1, review_key)
        if main == HEALTH_MAIN:
            return (2, review_key)
        return (3, review_key)

    return sorted(products, key=sort_key)


def count_domain_reviews_in_details(
    cluster: str,
    micro: str,
    main_category: str,
    sub_to_main: dict[str, str],
) -> int:
    details_path = CLUSTERING / "micro_cluster_details" / cluster / f"{micro}_details.json"
    if not details_path.exists():
        return 0
    details = load_json(details_path)
    count = 0
    for reviews in (details.get("members_grouped_by_user") or {}).values():
        for review in reviews:
            main = review.get("main_category") or sub_to_main.get(
                review.get("category", ""), review.get("category", "")
            )
            if main == main_category:
                count += 1
    return count


def count_vg_users_in_details(
    cluster: str,
    micro: str,
    sub_to_main: dict[str, str],
) -> int:
    """Users with at least one Video Games review in micro_cluster_details."""
    details_path = CLUSTERING / "micro_cluster_details" / cluster / f"{micro}_details.json"
    if not details_path.exists():
        return 0
    details = load_json(details_path)
    users_with_vg = 0
    for reviews in (details.get("members_grouped_by_user") or {}).values():
        if any(
            (review.get("main_category") or sub_to_main.get(review.get("category", ""), review.get("category", "")))
            == VIDEO_GAMES_MAIN
            for review in reviews
        ):
            users_with_vg += 1
    return users_with_vg


def load_video_games_tribe_stats() -> dict[tuple[str, str], dict[str, float | int | str]]:
    if not VIDEO_GAMES_PERFORMANCE_PATH.exists():
        return {}
    data = load_json(VIDEO_GAMES_PERFORMANCE_PATH)
    stats: dict[tuple[str, str], dict[str, float | int | str]] = {}
    scores: dict[tuple[str, str], list[float]] = {}
    names: dict[tuple[str, str], str] = {}
    for review in data.get("reviews") or []:
        key = (review["cluster"], review["micro"])
        scores.setdefault(key, []).append(float(review["overall_accuracy"]))
        names[key] = review.get("tribe") or names.get(key, "")
    for key, values in scores.items():
        stats[key] = {
            "n_reviews": len(values),
            "mean_accuracy": sum(values) / len(values),
            "tribe_name": names.get(key, ""),
        }
    return stats


def select_tribes(
    sub_to_main: dict[str, str],
    hc_by_tribe_user: dict[tuple[str, str], dict[str, list[dict]]],
    hc_scores: dict[str, float],
) -> tuple[list[tuple[str, str, str, int]], dict[tuple[str, str, str], int]]:
    """Return (domain, cluster, micro, review_count) tuples and lookup map."""
    hc_benchmark_scores: dict[tuple[str, str], list[float]] = {}
    for tribe_key, users in hc_by_tribe_user.items():
        for reviews in users.values():
            for review in reviews:
                score = hc_scores.get(review["review_key"])
                if score is not None:
                    hc_benchmark_scores.setdefault(tribe_key, []).append(score)

    # Healthcare tribes = only those present in healthcare_digital_technical_accuracy.json
    healthcare_candidates: list[tuple[tuple[str, str], int, float]] = []
    for tribe_key, users in hc_by_tribe_user.items():
        benchmark_reviews = sum(len(v) for v in users.values())
        if benchmark_reviews == 0:
            continue
        bench_scores = hc_benchmark_scores.get(tribe_key) or []
        mean_score = sum(bench_scores) / len(bench_scores) if bench_scores else 0.0
        healthcare_candidates.append((tribe_key, benchmark_reviews, mean_score))

    healthcare_candidates.sort(key=lambda item: (-item[2], -item[1]))
    healthcare = [
        ("healthcare", tribe_key[0], tribe_key[1], review_count)
        for tribe_key, review_count, _ in healthcare_candidates
    ]
    healthcare_keys = {(cluster, micro) for _, cluster, micro, _ in healthcare}

    video_games_candidates: list[tuple[tuple[str, str], int, int]] = []
    for cluster_dir in sorted((CLUSTERING / "micro_cluster_details").glob("cluster_*")):
        cluster = cluster_dir.name
        for details_path in sorted(cluster_dir.glob("micro_*_details.json")):
            micro = details_path.stem.replace("_details", "")
            tribe_key = (cluster, micro)
            if tribe_key in healthcare_keys:
                continue
            vg_reviews = count_domain_reviews_in_details(
                cluster, micro, VIDEO_GAMES_MAIN, sub_to_main
            )
            if vg_reviews < MIN_VG_TRIBE_REVIEWS:
                continue
            vg_users = count_vg_users_in_details(cluster, micro, sub_to_main)
            video_games_candidates.append((tribe_key, vg_reviews, vg_users))

    video_games_candidates.sort(key=lambda item: (-item[1], -item[2]))
    # UI catalog: single video games + software benchmark tribe (cluster_0/micro_0, >10pp filter applied at build).
    video_games = [
        ("video_games", VIDEO_GAMES_BENCHMARK_CLUSTER, VIDEO_GAMES_BENCHMARK_MICRO, 0),
    ]

    selected = healthcare + video_games
    review_counts = {
        (domain, cluster, micro): review_count for domain, cluster, micro, review_count in selected
    }
    return selected, review_counts


def normalize_user_characteristics_text(text: str) -> str:
    """UI/prompt copy: refer to modelled people as users, not reviewers."""
    if not text:
        return text
    out = text
    for pattern, repl in (
        (r"\bReviewers\b", "Users"),
        (r"\breviewers\b", "users"),
        (r"\bReviewer's\b", "User's"),
        (r"\breviewer's\b", "user's"),
        (r"\bReviewer\b", "User"),
        (r"\breviewer\b", "user"),
    ):
        out = re.sub(pattern, repl, out)
    return out


def load_user_category_characteristics() -> dict[str, dict[str, str]]:
    """user_id -> { main_category -> influencing_characteristics_summary }"""
    if not USER_CHARS_PATH.exists():
        return {}
    raw = load_json(USER_CHARS_PATH)
    out: dict[str, dict[str, str]] = {}
    for uid, user_data in raw.items():
        if not isinstance(user_data, dict):
            continue
        cat_chars = user_data.get("category_characteristics") or {}
        if not isinstance(cat_chars, dict):
            continue
        summaries: dict[str, str] = {}
        for main_cat, block in cat_chars.items():
            if isinstance(block, dict):
                summary = normalize_user_characteristics_text(
                    str(block.get("influencing_characteristics_summary") or "").strip()
                )
                if summary:
                    summaries[str(main_cat)] = summary
        if summaries:
            out[str(uid)] = summaries
    return out


def domain_category_characteristics(
    user_id: str,
    user_cat_chars: dict[str, dict[str, str]],
    domain: str,
) -> dict[str, str]:
    """Keep domain-relevant category blocks (healthcare → HPC; video games → VG + Software)."""
    if domain == "video_games":
        out: dict[str, str] = {}
        for main in (VIDEO_GAMES_MAIN, SOFTWARE_MAIN):
            text = (user_cat_chars.get(user_id) or {}).get(main, "").strip()
            if text:
                out[main] = text
        return out
    main = DOMAIN_MAIN_CATEGORY.get(domain)
    if not main:
        return {}
    text = (user_cat_chars.get(user_id) or {}).get(main, "").strip()
    return {main: text} if text else {}


def enrich_user_characteristics(
    user_id: str,
    characteristic_summary: str,
    user_cat_chars: dict[str, dict[str, str]],
) -> dict:
    general = normalize_user_characteristics_text(characteristic_summary)
    uid_chars = {
        cat: normalize_user_characteristics_text(summary)
        for cat, summary in (user_cat_chars.get(user_id) or {}).items()
    }
    return {
        "user_id": user_id,
        "characteristic_summary": general,
        "category_characteristics": uid_chars,
    }


def user_similarity_scores(
    cluster: str,
    micro: str,
    *,
    vg_scores: dict[str, float],
) -> dict[str, float]:
    """Mean UI similarity per user (video games catalog tribes)."""
    p = CLUSTERING / "Prediction_Accuracy_Refined" / cluster / f"{micro}_summary_enhanced_delta_corrected.json"
    if not p.exists():
        return {}
    data = load_json(p)
    preds = data.get("user_predictions") or {}
    scores: dict[str, list[float]] = {}
    for uid, reviews in preds.items():
        for rev in reviews:
            rk = str(rev.get("review_key") or "").strip()
            score = vg_scores.get(rk) if rk else None
            if score is None:
                metrics = rev.get("metrics") or {}
                score = app_similarity_score(
                    text_delta=(rev.get("best_deltas") or {}).get("text_delta")
                    or (rev.get("initial_deltas") or {}).get("text_delta"),
                    recall=metrics.get("recall@k")
                    or metrics.get(f"recall@max({metrics.get('num_actual_themes', 3)},k)"),
                    sentiment_match=metrics.get("sentiment_score"),
                )
            if score is not None:
                scores.setdefault(uid, []).append(float(score))
    return {uid: round(sum(v) / len(v), 4) for uid, v in scores.items() if v}


def product_accuracy_scores(
    cluster: str,
    micro: str,
    *,
    vg_scores: dict[str, float],
) -> dict[str, float]:
    """Per-review UI similarity (video games)."""
    out = {rk: s for rk, s in vg_scores.items() if s is not None}
    p = CLUSTERING / "Prediction_Accuracy_Refined" / cluster / f"{micro}_summary_enhanced_delta_corrected.json"
    if not p.exists():
        return out
    data = load_json(p)
    preds = data.get("user_predictions") or {}
    for reviews in preds.values():
        for rev in reviews:
            rk = str(rev.get("review_key") or "").strip()
            if not rk or rk in out:
                continue
            metrics = rev.get("metrics") or {}
            score = app_similarity_score(
                text_delta=(rev.get("best_deltas") or {}).get("text_delta")
                or (rev.get("initial_deltas") or {}).get("text_delta"),
                recall=metrics.get("recall@k"),
                sentiment_match=metrics.get("sentiment_score"),
            )
            if score is not None:
                out[rk] = score
    return out


def product_performance_score(product: dict, *, fallback_scores: dict[str, float]) -> float:
    rk = str(product.get("review_key") or "")
    if product.get("overall_similarity_score") is not None:
        return float(product["overall_similarity_score"])
    if product.get("similarity_score") is not None:
        return float(product["similarity_score"])
    if rk and rk in fallback_scores:
        return float(fallback_scores[rk])
    return 0.0


def sort_products_by_performance(
    products: list[dict],
    *,
    fallback_scores: dict[str, float] | None = None,
) -> list[dict]:
    fallback_scores = fallback_scores or {}
    return sorted(
        products,
        key=lambda p: (
            -product_performance_score(p, fallback_scores=fallback_scores),
            str(p.get("review_key") or ""),
        ),
    )


def mean_product_score(products: list[dict], *, fallback_scores: dict[str, float]) -> float:
    if not products:
        return 0.0
    return sum(
        product_performance_score(p, fallback_scores=fallback_scores) for p in products
    ) / len(products)


def sort_users_by_performance(users: list[dict]) -> list[dict]:
    return sorted(
        users,
        key=lambda u: (-float(u.get("similarity_score") or 0), str(u.get("user_id") or "")),
    )


def canonicalize_product_review_key(
    product: dict,
    user_id: str,
    global_keys: dict[tuple[str, str], str],
) -> str | None:
    rk = resolve_review_key(
        user_id,
        str(product.get("product_description") or ""),
        global_keys,
        existing_key=str(product.get("review_key") or ""),
    )
    if rk:
        product["review_key"] = rk
    return rk


def load_best_delta_predictions(
    cluster: str,
    micro: str,
    domain: str,
) -> tuple[dict[str, str], dict[tuple[str, str], str], str | None]:
    """review_key -> text; (user_id, normalized_description) -> text; source path."""
    bases = (
        ("amazon_sgo_health_care", "amazon_sgo")
        if domain == "healthcare"
        else ("amazon_sgo", "amazon_sgo_health_care")
    )
    candidates: list[Path] = []
    for base in bases:
        candidates.append(OUTPUTS / base / cluster / micro / "best_delta_predictions.json")
        if base == "amazon_sgo" and micro == "micro_7":
            candidates.append(OUTPUTS / base / cluster / "micro_7_best" / "best_delta_predictions.json")

    by_key: dict[str, str] = {}
    by_user_desc: dict[tuple[str, str], str] = {}
    source: str | None = None
    for path in candidates:
        if not path.exists():
            continue
        data = load_json(path)
        for row in data.get("reviews") or []:
            review_key = str(row.get("review_key") or "").strip()
            user_id = str(row.get("user_id") or "").strip()
            desc_key = normalize_product_key(row.get("product_description", ""))
            prediction = row.get("prediction") if isinstance(row.get("prediction"), dict) else {}
            review_text = str(prediction.get("review_text") or "").strip()
            if not review_text:
                continue
            if review_key:
                by_key[review_key] = review_text
            if user_id and desc_key:
                by_user_desc[(user_id, desc_key)] = review_text
        if by_key or by_user_desc:
            source = str(path.relative_to(WORKSPACE))
            break
    return by_key, by_user_desc, source


def attach_best_predictions(
    products: list[dict],
    best_by_key: dict[str, str],
    best_by_user_desc: dict[tuple[str, str], str],
    *,
    user_id: str,
) -> list[dict]:
    """Attach best_prediction_review when review_key matches SGO best_delta output."""
    if not best_by_key:
        return products

    for product in products:
        review_key = str(product.get("review_key") or "").strip()
        if review_key and review_key in best_by_key:
            product["best_prediction_review"] = best_by_key[review_key]
    return products


def load_sgo_reviews(cluster: str, micro: str) -> tuple[list[dict], str] | None:
    """Load canonical SGO benchmark reviews for micro_1 / micro_7."""
    key = (cluster, micro)
    path = SGO_REVIEW_SOURCES.get(key)
    if not path or not path.exists():
        return None

    if key == ("cluster_4", "micro_1"):
        data = load_json(path)
        rows = []
        for r in data.get("reviews", []):
            deltas = r.get("best_deltas") or {}
            sim = 1.0 - float(deltas.get("overall_delta", 0.5))
            actual = r.get("actual") or {}
            rows.append(
                {
                    "user_id": r["user_id"],
                    "review_key": r["review_key"],
                    "product_description": r.get("product_description", ""),
                    "review_text": actual.get("review_text", ""),
                    "rating": actual.get("rating"),
                    "category": r.get("category", "Health & Personal Care"),
                    "predicted_themes": actual.get("predicted_themes") or [],
                    "sentiment": actual.get("sentiment"),
                    "similarity_score": round(sim, 4),
                }
            )
        return rows, str(path.relative_to(WORKSPACE))

    if key == ("cluster_4", "micro_7"):
        data = load_json(path)
        rows = []
        for r in data.get("reviews", []):
            gt = r.get("ground_truth") or {}
            sapiens = (r.get("predictions") or {}).get("sapiens") or {}
            metrics = sapiens.get("metrics") or {}
            sim = float(metrics.get("overall_similarity_score", 0.5))
            rows.append(
                {
                    "user_id": r["user_id"],
                    "review_key": r["review_key"],
                    "product_description": r.get("product_description", ""),
                    "review_text": gt.get("review", ""),
                    "rating": None,
                    "category": r.get("category", "Health & Personal Care"),
                    "predicted_themes": gt.get("themes") or [],
                    "sentiment": gt.get("sentiment"),
                    "similarity_score": round(sim, 4),
                }
            )
        return rows, str(path.relative_to(WORKSPACE))

    return None


DOMAIN_MAIN_CATEGORY = {
    "healthcare": HEALTH_MAIN,
    "video_games": VIDEO_GAMES_MAIN,
}

# Every tribe shows products from both benchmark categories only.
TRIBE_PRODUCT_MAIN_CATEGORIES = {HEALTH_MAIN, VIDEO_GAMES_MAIN}


def filter_products_to_tribe_categories(
    products: list[dict],
    *,
    sub_to_main: dict[str, str],
) -> list[dict]:
    """Keep Video Games + Health & Personal Care; drop Software, Fashion, All Beauty, etc."""
    kept = []
    for product in products:
        main = sub_to_main.get(product.get("category", ""), product.get("category", ""))
        if main in TRIBE_PRODUCT_MAIN_CATEGORIES:
            kept.append(product)
    return kept


def build_user_history_reviews(
    cluster: str,
    micro: str,
    uid: str,
    *,
    target_main: str,
    sub_to_main: dict[str, str],
    excluded_mains: set[str] | frozenset[str] | None = None,
    included_mains: set[str] | frozenset[str] | None = None,
) -> list[dict]:
    """User review history from micro_cluster_details (for history baseline context)."""
    excluded = set(excluded_mains if excluded_mains is not None else {target_main})
    included = set(included_mains) if included_mains is not None else None
    details_path = CLUSTERING / "micro_cluster_details" / cluster / f"{micro}_details.json"
    if not details_path.exists():
        return []
    details = load_json(details_path)
    reviews = (details.get("members_grouped_by_user") or {}).get(uid) or []
    out: list[dict] = []
    seen: set[str] = set()
    for r in reviews:
        cat = r.get("category", "")
        main = r.get("main_category") or sub_to_main.get(cat, cat)
        if included is not None:
            if main not in included:
                continue
        elif main in excluded:
            continue
        text = str(r.get("review_text") or "").strip()
        if not text:
            continue
        key = normalize_product_key(text)
        if key in seen:
            continue
        seen.add(key)
        entry = {
            "review_text": text,
            "category": cat,
            "main_category": main,
        }
        review_key = str(r.get("review_key") or "").strip()
        if review_key:
            entry["review_key"] = review_key
        out.append(entry)
        if len(out) >= MAX_USER_HISTORY_REVIEWS:
            break
    return out


def build_user_same_category_history_reviews(
    cluster: str,
    micro: str,
    uid: str,
    *,
    target_main: str,
    sub_to_main: dict[str, str],
) -> list[dict]:
    """Same-category prior reviews — fallback when no other-category history exists."""
    return build_user_history_reviews(
        cluster,
        micro,
        uid,
        target_main=target_main,
        sub_to_main=sub_to_main,
        included_mains={target_main},
    )


def apply_product_ordering(
    products: list[dict],
    *,
    domain: str,
    uid: str,
    tribe_key: tuple[str, str],
    hc_by_tribe_user: dict[tuple[str, str], dict[str, list[dict]]],
    hc_scores: dict[str, float],
    hc_entries: dict[str, dict],
    sub_to_main: dict[str, str],
) -> list[dict]:
    """Merge digital healthcare benchmark products when available; order HC benchmark → VG → HPC."""
    bench = (hc_by_tribe_user.get(tribe_key) or {}).get(uid) or []
    # Canonical review_key for each product comes from tribe/SGO products, not healthcare file indices.
    desc_to_key = {
        normalize_product_key(p.get("product_description", "")): p["review_key"]
        for p in products
        if p.get("review_key") and normalize_product_key(p.get("product_description", ""))
    }
    priority_keys: set[str] = set()
    priority_descs: set[str] = set()
    for entry in bench:
        desc_key = normalize_product_key(entry.get("product_description", ""))
        if not desc_key:
            continue
        priority_descs.add(desc_key)
        canonical_key = desc_to_key.get(desc_key) or str(entry.get("review_key") or "").strip()
        if canonical_key:
            priority_keys.add(canonical_key)

    by_key: dict[str, dict] = {}

    for product in products:
        desc = normalize_product_key(product.get("product_description", ""))
        if desc in priority_descs:
            continue
        by_key[product["review_key"]] = product

    for entry in bench:
        desc_key = normalize_product_key(entry.get("product_description", ""))
        canonical_key = desc_to_key.get(desc_key)
        if not canonical_key:
            # Healthcare entry has no matching tribe product — skip merge (wrong tribe/user slot).
            continue
        product = healthcare_product_from_entry(entry, review_key=canonical_key)
        product["healthcare_benchmark"] = True
        by_key[canonical_key] = product

    products = list(by_key.values())
    ordered = sort_user_products(
        products,
        domain=domain,
        priority_keys=priority_keys,
        priority_scores=hc_scores,
        priority_descs=priority_descs,
        sub_to_main=sub_to_main,
    )
    for product in ordered:
        if product.get("healthcare_benchmark"):
            continue
        desc = normalize_product_key(product.get("product_description", ""))
        rk = product.get("review_key", "")
        product["healthcare_benchmark"] = rk in priority_keys or desc in priority_descs
    return sort_products_by_performance(ordered, fallback_scores=hc_scores)


def build_healthcare_digital_tribe(
    cluster: str,
    micro: str,
    definitions: list,
    population_def: str,
    user_cat_chars: dict[str, dict[str, str]],
    hc_by_tribe_user: dict[tuple[str, str], dict[str, list[dict]]],
    hc_scores: dict[str, float],
    hc_gaps: dict[str, float],
    history_gpt5_by_user_micro: dict[tuple[str, str, str], list[dict[str, Any]]],
    history_gpt5_by_user: dict[str, list[dict[str, Any]]],
    sub_to_main: dict[str, str],
    global_keys: dict[tuple[str, str], str],
) -> dict | None:
    """Build a healthcare tribe from digital/technical reviews only (no GT, prediction = reference)."""
    tribe_key = (cluster, micro)
    users_data = hc_by_tribe_user.get(tribe_key)
    if not users_data:
        return None

    details_path = CLUSTERING / "micro_cluster_details" / cluster / f"{micro}_details.json"
    details = load_json(details_path) if details_path.exists() else {}
    evo = find_evolution(cluster, micro)
    tribe_def = find_tribe_definition(definitions, cluster, micro)

    if evo:
        tribe_name = evo["tribe_name"] or details.get("persona_name", micro)
        qualitative = evo["qualitative_summary"]
        trait_source = "evolution_state.json"
    else:
        tribe_name = details.get("persona_name", micro)
        q = details.get("qualitative_summary") or {}
        qualitative = {
            "inherent_behavioral_traits": [{"text": t} for t in (q.get("core_characteristics") or [])[:8]],
            "latent_motivations": {"main": [{"text": t} for t in (q.get("key_motivations") or [])[:6]]},
            "validation_triggers": q.get("common_praises") or [],
            "friction_points": q.get("common_criticisms") or [],
            "implicit_goals": [{"text": t} for t in (q.get("potential_goals") or [])[:5]],
        }
        trait_source = "micro_cluster_details (seed)"
    tribe_desc = tribe_persona_description(tribe_def, tribe_name)

    members = details.get("member_user_characteristics") or []
    char_by_user = {
        m["user_id"]: normalize_user_characteristics_text(m.get("characteristic_summary", ""))
        for m in members
    }
    users_out: list[dict] = []
    for uid, entries in users_data.items():
        products: list[dict] = []
        for entry in entries:
            review_key = str(entry.get("review_key") or "").strip()
            if not review_key:
                continue
            product = healthcare_product_from_entry(
                entry,
                review_key=review_key,
                sapiens_baseline_gap=hc_gaps.get(review_key),
                history_baseline_context_reviews=history_gpt5_fallback_context(
                    entry,
                    by_user_micro=history_gpt5_by_user_micro,
                    by_user=history_gpt5_by_user,
                ),
            )
            if not canonicalize_product_review_key(product, uid, global_keys):
                product["review_key"] = review_key
            products.append(product)

        products = sort_products_by_sapiens_gap(products)
        if not products:
            continue

        user_gap = max(float(p.get("sapiens_baseline_gap") or 0) for p in products)

        user_history = build_user_history_reviews(
            cluster,
            micro,
            uid,
            target_main=HEALTH_MAIN,
            sub_to_main=sub_to_main,
            excluded_mains=HEALTHCARE_HISTORY_EXCLUDED_MAINS,
        )
        users_out.append(
            {
                "user_id": uid,
                "characteristic_summary": char_by_user.get(uid, ""),
                "category_characteristics": domain_category_characteristics(
                    uid, user_cat_chars, "healthcare"
                ),
                "similarity_score": round(user_gap, 4),
                "benchmark_product_count": len(products),
                "products": products,
                "user_history_reviews": user_history,
            }
        )

    if not users_out:
        return None

    users_out = sort_users_by_sapiens_gap(users_out)

    assert_products_have_global_keys(
        [{**p, "user_id": uid} for u in users_out for uid in [u["user_id"]] for p in u["products"]],
        global_keys,
        context=f"{cluster}/{micro}",
    )

    product_count = sum(len(u["products"]) for u in users_out)
    best_prediction_count = sum(
        1
        for u in users_out
        for p in u["products"]
        if p.get("best_prediction_review")
    )

    hc_source = str(HEALTHCARE_ACCURACY_PATH.relative_to(WORKSPACE))
    users_source = (
        f"{hc_source} + Clustering/micro_cluster_details/{cluster}/{micro}_details.json"
        if details_path.exists()
        else hc_source
    )

    return {
        "id": f"{cluster}-{micro}",
        "cluster": cluster,
        "micro_id": micro,
        "domain": "healthcare",
        "tribe_name": tribe_name,
        "tribe_description": tribe_desc,
        "tribe_definition": tribe_def,
        "population_definition": population_def,
        "trait_source": trait_source,
        "data_sources": {
            "users": users_source,
            "products": hc_source,
            "similarity": hc_source,
            "traits": trait_source,
            "best_predictions": hc_source,
        },
        "qualitative_summary": qualitative,
        "member_user_characteristics": [
            {
                "user_id": u["user_id"],
                "characteristic_summary": u["characteristic_summary"],
                "category_characteristics": u.get("category_characteristics") or {},
                "similarity_score": u["similarity_score"],
                "user_history_reviews": u.get("user_history_reviews") or [],
            }
            for u in users_out
        ],
        "members_grouped_by_user": {u["user_id"]: u["products"] for u in users_out},
        "best_prediction_count": best_prediction_count,
        "product_count": product_count,
        "mean_similarity_score": tribe_mean_similarity(
            {"members_grouped_by_user": {u["user_id"]: u["products"] for u in users_out}}
        ),
        "mean_sapiens_baseline_gap": tribe_mean_sapiens_baseline_gap(
            {"members_grouped_by_user": {u["user_id"]: u["products"] for u in users_out}}
        ),
    }


def build_video_games_software_benchmark_tribe(
    cluster: str,
    micro: str,
    definitions: list,
    population_def: str,
    user_cat_chars: dict[str, dict[str, str]],
    vg_gaps: dict[str, float],
    vg_rows: dict[str, dict],
    sub_to_main: dict[str, str],
    global_keys: dict[tuple[str, str], str],
) -> dict | None:
    """Build cluster_0/micro_0 from best_delta predictions filtered to >10pp Sapiens wins."""
    if not BEST_DELTA_VG_PATH.is_file() or not vg_gaps:
        return None

    details_path = VIDEO_GAMES_SOFTWARE_DETAILS_DIR / cluster / f"{micro}_details.json"
    if not details_path.is_file():
        details_path = CLUSTERING / "micro_cluster_details" / cluster / f"{micro}_details.json"
    if not details_path.is_file():
        return None

    details = load_json(details_path)
    evo = find_evolution(cluster, micro)
    tribe_def = find_tribe_definition(definitions, cluster, micro)

    if evo:
        tribe_name = evo["tribe_name"] or details.get("persona_name", micro)
        qualitative = evo["qualitative_summary"]
        trait_source = "evolution_state.json"
    else:
        tribe_name = details.get("persona_name", micro)
        q = details.get("qualitative_summary") or {}
        qualitative = {
            "inherent_behavioral_traits": [{"text": t} for t in (q.get("core_characteristics") or [])[:8]],
            "latent_motivations": {"main": [{"text": t} for t in (q.get("key_motivations") or [])[:6]]},
            "validation_triggers": q.get("common_praises") or [],
            "friction_points": q.get("common_criticisms") or [],
            "implicit_goals": [{"text": t} for t in (q.get("potential_goals") or [])[:5]],
        }
        trait_source = "micro_cluster_details (seed)"
    tribe_desc = tribe_persona_description(tribe_def, tribe_name)

    best_delta = load_json(BEST_DELTA_VG_PATH)
    by_user: dict[str, list[dict]] = {}
    for row in best_delta.get("reviews") or []:
        review_key = str(row.get("review_key") or "").strip()
        if not review_key or review_key not in vg_gaps:
            continue
        uid = str(row.get("user_id") or "").strip()
        if not uid:
            continue
        by_user.setdefault(uid, []).append(row)

    members = details.get("member_user_characteristics") or []
    char_by_user = {
        m["user_id"]: normalize_user_characteristics_text(m.get("characteristic_summary", ""))
        for m in members
    }

    users_out: list[dict] = []
    for uid, rows in by_user.items():
        products: list[dict] = []
        for row in rows:
            review_key = str(row.get("review_key") or "").strip()
            product = video_games_benchmark_product_from_row(
                row,
                review_key=review_key,
                sapiens_baseline_gap=vg_gaps.get(review_key),
                analysis_row=vg_rows.get(review_key),
            )
            if not canonicalize_product_review_key(product, uid, global_keys):
                product["review_key"] = review_key
            products.append(product)

        products = sort_products_by_sapiens_gap(products)
        if not products:
            continue

        user_gap = max(float(p.get("sapiens_baseline_gap") or 0) for p in products)
        user_history = build_user_history_reviews(
            cluster,
            micro,
            uid,
            target_main=VIDEO_GAMES_MAIN,
            sub_to_main=sub_to_main,
            included_mains=VIDEO_GAMES_SOFTWARE_MAINS,
        )
        users_out.append(
            {
                "user_id": uid,
                "characteristic_summary": char_by_user.get(uid, ""),
                "category_characteristics": domain_category_characteristics(
                    uid, user_cat_chars, "video_games"
                ),
                "similarity_score": round(user_gap, 4),
                "benchmark_product_count": len(products),
                "products": products,
                "user_history_reviews": user_history,
            }
        )

    if not users_out:
        return None

    users_out = sort_users_by_sapiens_gap(users_out)

    assert_products_have_global_keys(
        [{**p, "user_id": uid} for u in users_out for uid in [u["user_id"]] for p in u["products"]],
        global_keys,
        context=f"{cluster}/{micro}",
    )

    product_count = sum(len(u["products"]) for u in users_out)
    best_prediction_count = sum(
        1 for u in users_out for p in u["products"] if p.get("best_prediction_review")
    )
    vg_source = str(BEST_DELTA_VG_PATH.relative_to(WORKSPACE))
    analysis_source = str(SAPIENS_VS_BASELINES_VG_PATH.relative_to(WORKSPACE))
    details_rel = str(details_path.relative_to(WORKSPACE))

    return {
        "id": f"{cluster}-{micro}",
        "cluster": cluster,
        "micro_id": micro,
        "domain": "video_games",
        "tribe_name": tribe_name,
        "tribe_description": tribe_desc,
        "tribe_definition": tribe_def,
        "population_definition": population_def,
        "trait_source": trait_source,
        "data_sources": {
            "users": f"{details_rel} + {vg_source}",
            "products": vg_source,
            "similarity": analysis_source,
            "traits": trait_source,
            "best_predictions": vg_source,
        },
        "qualitative_summary": qualitative,
        "member_user_characteristics": [
            {
                "user_id": u["user_id"],
                "characteristic_summary": u["characteristic_summary"],
                "category_characteristics": u.get("category_characteristics") or {},
                "similarity_score": u["similarity_score"],
                "user_history_reviews": u.get("user_history_reviews") or [],
            }
            for u in users_out
        ],
        "members_grouped_by_user": {u["user_id"]: u["products"] for u in users_out},
        "best_prediction_count": best_prediction_count,
        "product_count": product_count,
        "mean_similarity_score": tribe_mean_similarity(
            {"members_grouped_by_user": {u["user_id"]: u["products"] for u in users_out}}
        ),
        "mean_sapiens_baseline_gap": tribe_mean_sapiens_baseline_gap(
            {"members_grouped_by_user": {u["user_id"]: u["products"] for u in users_out}}
        ),
    }


def build_tribe(
    cluster: str,
    micro: str,
    domain: str,
    definitions: list,
    population_def: str,
    user_cat_chars: dict[str, dict[str, str]],
    hc_by_tribe_user: dict[tuple[str, str], dict[str, list[dict]]],
    hc_scores: dict[str, float],
    hc_gaps: dict[str, float],
    history_gpt5_by_user_micro: dict[tuple[str, str, str], list[dict[str, Any]]],
    history_gpt5_by_user: dict[str, list[dict[str, Any]]],
    hc_entries: dict[str, dict],
    sub_to_main: dict[str, str],
    global_keys: dict[tuple[str, str], str],
    vg_scores: dict[str, float],
    vg_gaps: dict[str, float] | None = None,
    vg_rows: dict[str, dict] | None = None,
) -> dict | None:
    if domain == "healthcare":
        return build_healthcare_digital_tribe(
            cluster,
            micro,
            definitions,
            population_def,
            user_cat_chars,
            hc_by_tribe_user,
            hc_scores,
            hc_gaps,
            history_gpt5_by_user_micro,
            history_gpt5_by_user,
            sub_to_main,
            global_keys,
        )

    if (
        domain == "video_games"
        and (cluster, micro) == (VIDEO_GAMES_BENCHMARK_CLUSTER, VIDEO_GAMES_BENCHMARK_MICRO)
    ):
        return build_video_games_software_benchmark_tribe(
            cluster,
            micro,
            definitions,
            population_def,
            user_cat_chars,
            vg_gaps or {},
            vg_rows or {},
            sub_to_main,
            global_keys,
        )

    details_path = CLUSTERING / "micro_cluster_details" / cluster / f"{micro}_details.json"
    if not details_path.exists():
        print(f"  SKIP {cluster}/{micro}: no details file")
        return None

    target_main = DOMAIN_MAIN_CATEGORY.get(domain, VIDEO_GAMES_MAIN)
    details = load_json(details_path)
    evo = find_evolution(cluster, micro)
    tribe_def = find_tribe_definition(definitions, cluster, micro)

    if evo:
        tribe_name = evo["tribe_name"] or details.get("persona_name", micro)
        qualitative = evo["qualitative_summary"]
        trait_source = "evolution_state.json"
    else:
        tribe_name = details.get("persona_name", micro)
        q = details.get("qualitative_summary") or {}
        qualitative = {
            "inherent_behavioral_traits": [{"text": t} for t in (q.get("core_characteristics") or [])[:8]],
            "latent_motivations": {"main": [{"text": t} for t in (q.get("key_motivations") or [])[:6]]},
            "validation_triggers": q.get("common_praises") or [],
            "friction_points": q.get("common_criticisms") or [],
            "implicit_goals": [{"text": t} for t in (q.get("potential_goals") or [])[:5]],
        }
        trait_source = "micro_cluster_details (seed)"
    tribe_desc = tribe_persona_description(tribe_def, tribe_name)

    members = details.get("member_user_characteristics") or []
    grouped = details.get("members_grouped_by_user") or {}
    char_by_user = {
        m["user_id"]: normalize_user_characteristics_text(m.get("characteristic_summary", ""))
        for m in members
    }

    users_source = f"Clustering/micro_cluster_details/{cluster}/{micro}_details.json"
    similarity_source = (
        f"Clustering/Prediction_Accuracy_Refined/{cluster}/{micro}_summary_enhanced_delta_corrected.json"
    )
    products_source = users_source

    sgo = load_sgo_reviews(cluster, micro)
    best_by_key, best_by_user_desc, best_prediction_source = load_best_delta_predictions(
        cluster, micro, domain
    )
    tribe_key = (cluster, micro)
    users_out: list[dict] = []
    prod_scores = product_accuracy_scores(cluster, micro, vg_scores=vg_scores)
    all_scores = {**hc_scores, **prod_scores}

    if sgo:
        sgo_rows, products_source = sgo
        similarity_source = products_source
        by_user: dict[str, list[dict]] = {}
        for row in sgo_rows:
            by_user.setdefault(row["user_id"], []).append(row)

        for uid, reviews in by_user.items():
            benchmark_product_count = len((hc_by_tribe_user.get(tribe_key) or {}).get(uid) or [])
            products = [
                {
                    "review_key": r["review_key"],
                    "product_description": r["product_description"],
                    "review_text": r["review_text"],
                    "rating": r["rating"],
                    "category": r["category"],
                    "predicted_themes": r["predicted_themes"],
                    "sentiment": r.get("sentiment"),
                    "overall_similarity_score": float(r["similarity_score"]),
                }
                for r in reviews
            ]
            products = [
                p for p in products
                if canonicalize_product_review_key(p, uid, global_keys)
            ]
            products = apply_product_ordering(
                products,
                domain=domain,
                uid=uid,
                tribe_key=tribe_key,
                hc_by_tribe_user=hc_by_tribe_user,
                hc_scores=hc_scores,
                hc_entries=hc_entries,
                sub_to_main=sub_to_main,
            )
            products = filter_products_to_tribe_categories(
                products, sub_to_main=sub_to_main
            )
            if not products:
                continue
            products = attach_best_predictions(
                products, best_by_key, best_by_user_desc, user_id=uid
            )
            for product in products:
                rk = str(product.get("review_key") or "")
                if rk in all_scores:
                    product["overall_similarity_score"] = all_scores[rk]
            products = sort_products_by_performance(products, fallback_scores=all_scores)
            mean_sim = mean_product_score(products, fallback_scores=all_scores)
            user_history = build_user_history_reviews(
                cluster, micro, uid, target_main=target_main, sub_to_main=sub_to_main
            )
            same_category_history = build_user_same_category_history_reviews(
                cluster, micro, uid, target_main=target_main, sub_to_main=sub_to_main
            )
            users_out.append(
                {
                    "user_id": uid,
                    "characteristic_summary": char_by_user.get(uid, ""),
                    "category_characteristics": domain_category_characteristics(
                        uid, user_cat_chars, domain
                    ),
                    "similarity_score": round(mean_sim, 4),
                    "benchmark_product_count": benchmark_product_count,
                    "products": products,
                    "user_history_reviews": user_history,
                    "user_same_category_history_reviews": same_category_history,
                }
            )
        users_source = (
            f"Clustering/micro_cluster_details/{cluster}/{micro}_details.json"
            + " (user characteristics)"
        )
    else:
        for m in members:
            uid = m["user_id"]
            reviews = grouped.get(uid) or []
            benchmark_product_count = len((hc_by_tribe_user.get(tribe_key) or {}).get(uid) or [])
            products = []
            for r in reviews:
                product = {
                    "product_description": r.get("product_description", ""),
                    "review_text": r.get("review_text", ""),
                    "rating": r.get("rating"),
                    "category": r.get("category", "Health & Personal Care"),
                    "predicted_themes": r.get("predicted_themes") or r.get("themes") or [],
                    "sentiment": r.get("sentiment"),
                }
                if r.get("review_key"):
                    product["review_key"] = r["review_key"]
                if not canonicalize_product_review_key(product, uid, global_keys):
                    continue
                products.append(product)
            products = apply_product_ordering(
                products,
                domain=domain,
                uid=uid,
                tribe_key=tribe_key,
                hc_by_tribe_user=hc_by_tribe_user,
                hc_scores=hc_scores,
                hc_entries=hc_entries,
                sub_to_main=sub_to_main,
            )
            products = filter_products_to_tribe_categories(
                products, sub_to_main=sub_to_main
            )
            if not products:
                continue
            products = attach_best_predictions(
                products, best_by_key, best_by_user_desc, user_id=uid
            )
            for product in products:
                rk = str(product.get("review_key") or "")
                if product.get("overall_similarity_score") is None and rk in all_scores:
                    product["overall_similarity_score"] = all_scores[rk]
            products = sort_products_by_performance(products, fallback_scores=all_scores)
            mean_sim = mean_product_score(products, fallback_scores=all_scores)
            user_history = build_user_history_reviews(
                cluster, micro, uid, target_main=target_main, sub_to_main=sub_to_main
            )
            same_category_history = build_user_same_category_history_reviews(
                cluster, micro, uid, target_main=target_main, sub_to_main=sub_to_main
            )
            users_out.append(
                {
                    "user_id": uid,
                    "characteristic_summary": normalize_user_characteristics_text(
                        m.get("characteristic_summary", "")
                    ),
                    "category_characteristics": domain_category_characteristics(
                        uid, user_cat_chars, domain
                    ),
                    "similarity_score": round(mean_sim, 4),
                    "benchmark_product_count": benchmark_product_count,
                    "products": products,
                    "user_history_reviews": user_history,
                    "user_same_category_history_reviews": same_category_history,
                }
            )

    users_out = sort_users_by_performance(users_out)

    if tribe_key in hc_by_tribe_user:
        products_source = (
            f"{HEALTHCARE_ACCURACY_PATH.relative_to(WORKSPACE)}"
            f" + Clustering/micro_cluster_details/{cluster}/{micro}_details.json"
        )

    assert_products_have_global_keys(
        [{**p, "user_id": uid} for u in users_out for uid in [u["user_id"]] for p in u["products"]],
        global_keys,
        context=f"{cluster}/{micro}",
    )

    best_prediction_count = sum(
        1
        for user in users_out
        for product in user["products"]
        if product.get("best_prediction_review")
    )
    product_count = sum(len(user["products"]) for user in users_out)

    data_sources = {
        "users": users_source,
        "products": products_source,
        "similarity": similarity_source,
        "traits": trait_source,
    }
    if best_prediction_source and best_prediction_count:
        data_sources["best_predictions"] = best_prediction_source

    return {
        "id": f"{cluster}-{micro}",
        "cluster": cluster,
        "micro_id": micro,
        "domain": domain,
        "tribe_name": tribe_name,
        "tribe_description": tribe_desc,
        "tribe_definition": tribe_def,
        "population_definition": population_def,
        "trait_source": trait_source,
        "data_sources": data_sources,
        "qualitative_summary": qualitative,
        "member_user_characteristics": [
            {
                "user_id": u["user_id"],
                "characteristic_summary": u["characteristic_summary"],
                "category_characteristics": u.get("category_characteristics") or {},
                "similarity_score": u["similarity_score"],
                "user_history_reviews": u.get("user_history_reviews") or [],
                "user_same_category_history_reviews": u.get("user_same_category_history_reviews") or [],
            }
            for u in users_out
        ],
        "members_grouped_by_user": {u["user_id"]: u["products"] for u in users_out},
        "best_prediction_count": best_prediction_count,
        "product_count": product_count,
        "mean_similarity_score": tribe_mean_similarity(
            {"members_grouped_by_user": {u["user_id"]: u["products"] for u in users_out}}
        ),
    }


def main() -> None:
    tribe_defs_data = load_json(CLUSTERING / "micro_cluster_tribe_definitions.json")
    definitions = tribe_defs_data.get("definitions") or []

    pop_data = load_json(CLUSTERING / "category_generic_tribe_definitions.json")
    default_hc_population = (
        pop_data.get("definitions", {})
        .get("Health & Personal Care", {})
        .get("tribe_definition", POPULATION_DEFINITIONS["healthcare"])
    )
    POPULATION_DEFINITIONS["healthcare"] = default_hc_population

    tribes_dir = OUT_DIR / "tribes"
    tribes_dir.mkdir(parents=True, exist_ok=True)

    user_cat_chars = load_user_category_characteristics()
    sub_to_main = load_category_mapping()
    global_keys = load_global_review_key_index()
    print(f"Loaded {len(global_keys)} global review_key mappings")
    hc_by_tribe_user, hc_scores, hc_entries = load_healthcare_benchmark_index()
    hc_gaps = load_healthcare_sapiens_baseline_gaps(hc_entries, hc_scores)
    total_hc_reviews = len(hc_entries)
    hc_by_tribe_user, hc_scores, hc_entries, hc_gaps = filter_healthcare_benchmark_by_gap(
        hc_by_tribe_user, hc_scores, hc_entries, hc_gaps
    )
    history_gpt5_by_user_micro, history_gpt5_by_user = load_healthcare_history_gpt5_prediction_index()
    vg_scores = load_video_games_app_scores()
    vg_gaps_all, vg_rows_all = load_video_games_sapiens_baseline_analysis()
    total_vg_reviews = len(vg_gaps_all)
    vg_gaps, vg_rows = filter_video_games_benchmark_by_gap(vg_gaps_all, vg_rows_all)
    selected_tribes, tribe_review_counts = select_tribes(sub_to_main, hc_by_tribe_user, hc_scores)
    # Patch review count for the single video games benchmark tribe.
    tribe_review_counts[("video_games", VIDEO_GAMES_BENCHMARK_CLUSTER, VIDEO_GAMES_BENCHMARK_MICRO)] = len(
        vg_gaps
    )
    print(f"Loaded category characteristics for {len(user_cat_chars)} users")
    print(
        f"Healthcare UI filter (>10pp Sapiens vs best baseline): "
        f"{len(hc_entries)}/{total_hc_reviews} reviews across {len(hc_by_tribe_user)} tribes"
    )
    print(
        f"Video games UI filter (>10pp Sapiens vs best baseline): "
        f"{len(vg_gaps)}/{total_vg_reviews} reviews for {VIDEO_GAMES_BENCHMARK_CLUSTER}/{VIDEO_GAMES_BENCHMARK_MICRO}"
    )
    print(f"Loaded {len(hc_gaps)} healthcare Sapiens vs baseline gap scores")
    print(
        f"Loaded {sum(len(v) for v in history_gpt5_by_user_micro.values())} history · gpt-5 fallback predictions"
    )
    print(f"Loaded {len(vg_scores)} video games UI similarity scores")
    print(
        f"Selected {sum(1 for d, _, _, _ in selected_tribes if d == 'healthcare')} healthcare (digital) + "
        f"{sum(1 for d, _, _, _ in selected_tribes if d == 'video_games')} video games tribes"
    )

    # Bundle category reference data for prompts
    cat_themes_src = CLUSTERING / "category_themes.json"
    cat_map_src = CATEGORY_MAPPING_PATH
    if cat_themes_src.exists():
        (OUT_DIR / "category-themes.json").write_text(
            cat_themes_src.read_text(encoding="utf-8"), encoding="utf-8"
        )
    if cat_map_src.exists():
        (OUT_DIR / "category-mapping.json").write_text(
            cat_map_src.read_text(encoding="utf-8"), encoding="utf-8"
        )

    index = []
    built_ids: set[str] = set()
    built = 0
    for domain, cluster, micro, review_count in selected_tribes:
        print(f"Building {domain} {cluster}/{micro} ({review_count} reviews)...")
        population_def = POPULATION_DEFINITIONS[domain]
        tribe = build_tribe(
            cluster,
            micro,
            domain,
            definitions,
            population_def,
            user_cat_chars,
            hc_by_tribe_user,
            hc_scores,
            hc_gaps,
            history_gpt5_by_user_micro,
            history_gpt5_by_user,
            hc_entries,
            sub_to_main,
            global_keys,
            vg_scores,
            vg_gaps,
            vg_rows,
        )
        if not tribe:
            continue
        out_path = tribes_dir / f"{tribe['id']}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(tribe, f, ensure_ascii=False)
        built_ids.add(tribe["id"])
        index.append({
            "id": tribe["id"],
            "name": tribe["tribe_name"],
            "cluster": cluster,
            "microId": micro,
            "domain": domain,
            "reviewCount": tribe.get("product_count", review_count),
            "description": tribe["tribe_definition"] or tribe["tribe_description"],
            "userCount": len(tribe["member_user_characteristics"]),
            "traitSource": tribe["trait_source"],
            "dataSources": tribe["data_sources"],
            "traitCounts": {
                "behavioral": len(tribe["qualitative_summary"].get("inherent_behavioral_traits") or []),
                "motivations": len((tribe["qualitative_summary"].get("latent_motivations") or {}).get("main") or []),
                "triggers": len(tribe["qualitative_summary"].get("validation_triggers") or []),
                "friction": len(tribe["qualitative_summary"].get("friction_points") or []),
                "goals": len(tribe["qualitative_summary"].get("implicit_goals") or []),
            },
            "meanSimilarityScore": tribe.get("mean_similarity_score", 0.0),
            "meanSapiensBaselineGap": tribe.get("mean_sapiens_baseline_gap", 0.0),
        })
        built += 1
        print(
            f"  -> {tribe['tribe_name']} ({len(tribe['member_user_characteristics'])} users, "
            f"{tribe.get('best_prediction_count', 0)} best predictions, "
            f"traits from {tribe['trait_source']})"
        )

    for stale in tribes_dir.glob("*.json"):
        if stale.stem not in built_ids:
            stale.unlink()
            print(f"Removed stale tribe file: {stale.name}")

    index.sort(
        key=lambda t: (
            0 if t.get("domain") == "healthcare" else 1,
            -float(
                t.get("meanSapiensBaselineGap") or 0
                if t.get("domain") in {"healthcare", "video_games"}
                else t.get("meanSimilarityScore") or 0
            ),
            -int(t.get("reviewCount") or 0),
        )
    )

    with open(OUT_DIR / "catalog-index.json", "w", encoding="utf-8") as f:
        json.dump({"tribes": index, "total": built}, f, ensure_ascii=False, indent=2)

    print(f"\nDone: {built} tribes written to {tribes_dir}")


if __name__ == "__main__":
    main()
