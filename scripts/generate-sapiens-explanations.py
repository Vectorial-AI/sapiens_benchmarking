#!/usr/bin/env python3
"""
Generate Sapiens-vs-baseline explanations for healthcare UI catalog reviews.

Uses the same >10pp filter as build-catalog.py. For each review, picks the best
baseline across 15 runs (5 models × 3 methods), calls an LLM, and writes
src/data/sapiens-baseline-explanations.json.

Local test:
  python3 scripts/generate-sapiens-explanations.py --limit 1 --dry-run
  python3 scripts/generate-sapiens-explanations.py --limit 1
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
APP_DIR = SCRIPT_DIR.parent
WORKSPACE = APP_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

import importlib.util

_build_catalog_spec = importlib.util.spec_from_file_location(
    "build_catalog", SCRIPT_DIR / "build-catalog.py"
)
assert _build_catalog_spec and _build_catalog_spec.loader
build_catalog = importlib.util.module_from_spec(_build_catalog_spec)
_build_catalog_spec.loader.exec_module(build_catalog)

APP_WEIGHT_SENTIMENT = build_catalog.APP_WEIGHT_SENTIMENT
APP_WEIGHT_TEXT = build_catalog.APP_WEIGHT_TEXT
APP_WEIGHT_THEME = build_catalog.APP_WEIGHT_THEME
BASELINE_MODELS = build_catalog.BASELINE_MODELS
HIST_BASELINE_DIR = build_catalog.HIST_BASELINE_DIR
MIN_UI_SAPIENS_BASELINE_GAP = build_catalog.MIN_UI_SAPIENS_BASELINE_GAP
TRIBE_BASELINE_DIR = build_catalog.TRIBE_BASELINE_DIR
_baseline_join_key = build_catalog._baseline_join_key
_baseline_overall_similarity = build_catalog._baseline_overall_similarity
_baseline_sentiment_score = build_catalog._baseline_sentiment_score
filter_healthcare_benchmark_by_gap = build_catalog.filter_healthcare_benchmark_by_gap
load_healthcare_benchmark_index = build_catalog.load_healthcare_benchmark_index
load_healthcare_sapiens_baseline_gaps = build_catalog.load_healthcare_sapiens_baseline_gaps
load_json = build_catalog.load_json

PROMPT_PATH = APP_DIR / "prompts" / "sapiens_vs_baseline_explanation.txt"
OUT_PATH = APP_DIR / "src" / "data" / "sapiens-baseline-explanations.json"
ENV_PATH = WORKSPACE / ".env"

BASELINE_METHOD_LABELS = {
    "history": "History baseline",
    "tribe_persona": "Tribe persona baseline",
    "population_persona": "Population persona baseline",
}

BASELINE_METHOD_DESCRIPTIONS = {
    "history": (
        "Uses the user's prior Amazon reviews (excluding healthcare and beauty) as in-context "
        "examples. No evolved tribe traits or individual user characteristics."
    ),
    "tribe_persona": (
        "Uses a static tribe persona definition only. No user history or evolved traits."
    ),
    "population_persona": (
        "Uses a generic category population definition. No tribe-specific or user-specific context."
    ),
}

BASELINE_SOURCES: list[tuple[str, Path, str]] = [
    ("history", HIST_BASELINE_DIR, "*_confidence_history.json"),
    ("tribe_persona", TRIBE_BASELINE_DIR, "*_confidence_tribe.json"),
    (
        "population_persona",
        TRIBE_BASELINE_DIR,
        "*_confidence_category_generic_tribe.json",
    ),
]


def load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def pct(value: float | None, *, digits: int = 1) -> str:
    if value is None:
        return "n/a"
    return f"{round(float(value) * 100, digits):.{digits}f}"


def theme_list(themes: Any) -> str:
    if isinstance(themes, list):
        return ", ".join(str(t) for t in themes if t) or "(none)"
    if isinstance(themes, dict):
        active = [k for k, v in themes.items() if float(v or 0) >= 0.5]
        return ", ".join(active) or "(none)"
    return "(none)"


def metric_block(acc: dict[str, Any]) -> dict[str, float | None]:
    text_delta = acc.get("text_delta")
    text_sim = acc.get("text_similarity")
    if text_sim is None and text_delta is not None:
        text_sim = max(0.0, 1.0 - float(text_delta))
    recall = acc.get("recall@k")
    sentiment = acc.get("sentiment_score")
    overall = acc.get("ui_overall_similarity")
    if overall is None and text_sim is not None and recall is not None:
        parts = [APP_WEIGHT_TEXT * float(text_sim), APP_WEIGHT_THEME * float(recall)]
        if sentiment is not None:
            parts.append(float(sentiment) * APP_WEIGHT_SENTIMENT)
        overall = round(sum(parts), 4)
    return {
        "text_similarity": float(text_sim) if text_sim is not None else None,
        "recall@k": float(recall) if recall is not None else None,
        "sentiment_score": float(sentiment) if sentiment is not None else None,
        "ui_overall_similarity": float(overall) if overall is not None else None,
    }


def find_best_baselines(
    hc_entries: dict[str, dict],
) -> dict[str, dict[str, Any]]:
    gt_sent_by_join: dict[tuple[str, str], Any] = {}
    review_key_by_join: dict[tuple[str, str], str] = {}
    for review_key, entry in hc_entries.items():
        jk = _baseline_join_key(entry.get("user_id", ""), entry.get("product_description", ""))
        gt_sent_by_join[jk] = (entry.get("ground_truth") or {}).get("sentiment")
        review_key_by_join[jk] = review_key

    best_by_join: dict[tuple[str, str], dict[str, Any]] = {}

    def consider(
        jk: tuple[str, str],
        *,
        method: str,
        model: str,
        row: dict[str, Any],
        score: float,
    ) -> None:
        existing = best_by_join.get(jk)
        if existing is not None and float(existing["score"]) >= score:
            return
        pred = row.get("prediction") or {}
        metrics = row.get("metrics") or {}
        best_by_join[jk] = {
            "method": method,
            "model": model,
            "score": round(score, 4),
            "review_text": str(pred.get("review_text") or "").strip(),
            "themes": pred.get("predicted_themes") or pred.get("themes") or [],
            "sentiment": pred.get("sentiment"),
            "metrics": metrics,
        }

    for method, base_dir, pattern in BASELINE_SOURCES:
        for model in BASELINE_MODELS:
            model_dir = base_dir / model
            if not model_dir.is_dir():
                continue
            for path in sorted(model_dir.glob(f"cluster_*/micro_{pattern}")):
                for row in load_json(path).get("predictions") or []:
                    jk = _baseline_join_key(
                        row.get("user_id", ""),
                        row.get("product_description", ""),
                    )
                    if jk not in review_key_by_join:
                        continue
                    metrics = row.get("metrics") or {}
                    pred = row.get("prediction") or {}
                    score = _baseline_overall_similarity(
                        metrics.get("text_delta"),
                        metrics.get("recall@k"),
                        _baseline_sentiment_score(gt_sent_by_join.get(jk), pred.get("sentiment")),
                    )
                    if score is None:
                        continue
                    consider(jk, method=method, model=model, row=row, score=float(score))

    out: dict[str, dict[str, Any]] = {}
    for jk, payload in best_by_join.items():
        review_key = review_key_by_join.get(jk)
        if review_key:
            out[review_key] = payload
    return out


def build_prompt(entry: dict[str, Any], baseline: dict[str, Any], gap: float) -> str:
    template = PROMPT_PATH.read_text(encoding="utf-8")
    gt = entry.get("ground_truth") or {}
    sapiens = entry.get("prediction") or {}
    sapiens_acc = metric_block(entry.get("accuracy") or {})
    baseline_acc = metric_block(
        {
            "text_delta": baseline["metrics"].get("text_delta"),
            "recall@k": baseline["metrics"].get("recall@k"),
            "sentiment_score": _baseline_sentiment_score(
                gt.get("sentiment"), baseline.get("sentiment")
            ),
            "ui_overall_similarity": baseline.get("score"),
        }
    )
    method = str(baseline.get("method") or "history")
    replacements = {
        "baseline_method_label": BASELINE_METHOD_LABELS.get(method, method),
        "baseline_method_description": BASELINE_METHOD_DESCRIPTIONS.get(method, ""),
        "product_description": entry.get("product_description", ""),
        "ground_truth_rating": gt.get("rating", "n/a"),
        "ground_truth_sentiment": gt.get("sentiment", "n/a"),
        "ground_truth_themes": theme_list(gt.get("themes")),
        "ground_truth_review": str(gt.get("review") or "").strip(),
        "sapiens_overall_pct": pct(sapiens_acc["ui_overall_similarity"]),
        "sapiens_text_sim_pct": pct(sapiens_acc["text_similarity"]),
        "sapiens_recall_pct": pct(sapiens_acc["recall@k"]),
        "sapiens_sentiment_match": pct(sapiens_acc["sentiment_score"], digits=0),
        "sapiens_themes": theme_list(sapiens.get("themes")),
        "sapiens_review": str(sapiens.get("review") or "").strip(),
        "baseline_model": baseline.get("model", "unknown"),
        "baseline_overall_pct": pct(baseline_acc["ui_overall_similarity"]),
        "baseline_text_sim_pct": pct(baseline_acc["text_similarity"]),
        "baseline_recall_pct": pct(baseline_acc["recall@k"]),
        "baseline_sentiment_match": pct(baseline_acc["sentiment_score"], digits=0),
        "baseline_themes": theme_list(baseline.get("themes")),
        "baseline_review": str(baseline.get("review_text") or "").strip(),
        "gap_pp": pct(gap),
    }
    out = template
    for key, value in replacements.items():
        out = out.replace("{" + key + "}", str(value))
    return out


def parse_json_response(text: str) -> dict[str, Any] | None:
    try:
        start = text.index("{")
        end = text.rindex("}") + 1
        return json.loads(text[start:end])
    except (ValueError, json.JSONDecodeError):
        return None


def call_llm(prompt: str, *, model: str) -> str:
    import openai

    client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    response = client.chat.completions.create(
        model=model,
        temperature=0.2,
        messages=[
            {
                "role": "system",
                "content": (
                    "You compare behavioral review predictions for a benchmark. "
                    "Respond ONLY with valid JSON matching the requested schema."
                ),
            },
            {"role": "user", "content": prompt},
        ],
    )
    return response.choices[0].message.content or ""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=0, help="Max reviews to process (0 = all)")
    parser.add_argument("--model", default=os.environ.get("SAPIENS_EXPLAIN_MODEL", "gpt-4o"))
    parser.add_argument("--dry-run", action="store_true", help="Print prompt for first review only")
    parser.add_argument("--review-key", default="", help="Process a single review_key")
    args = parser.parse_args()

    load_dotenv(ENV_PATH)

    hc_by_tribe_user, hc_scores, hc_entries = load_healthcare_benchmark_index()
    hc_gaps = load_healthcare_sapiens_baseline_gaps(hc_entries, hc_scores)
    _, _, hc_entries, hc_gaps = filter_healthcare_benchmark_by_gap(
        hc_by_tribe_user, hc_scores, hc_entries, hc_gaps
    )
    best_baselines = find_best_baselines(hc_entries)

    review_keys = sorted(
        hc_entries.keys(),
        key=lambda rk: (-float(hc_gaps.get(rk, 0.0)), rk),
    )
    if args.review_key:
        if args.review_key not in hc_entries:
            raise SystemExit(f"Review key not in filtered catalog: {args.review_key}")
        review_keys = [args.review_key]
    elif args.limit > 0:
        review_keys = review_keys[: args.limit]

    print(f"Processing {len(review_keys)} healthcare reviews")

    existing: dict[str, Any] = {}
    if OUT_PATH.is_file():
        existing = load_json(OUT_PATH)

    results = dict(existing)

    for review_key in review_keys:
        entry = hc_entries[review_key]
        baseline = best_baselines.get(review_key)
        gap = float(hc_gaps.get(review_key, 0.0))
        if not baseline:
            print(f"  skip {review_key}: no baseline found")
            continue

        prompt = build_prompt(entry, baseline, gap)
        if args.dry_run:
            print("\n=== PROMPT ===\n")
            print(prompt[:4000])
            if len(prompt) > 4000:
                print(f"\n... [{len(prompt) - 4000} more chars]")
            print("\n=== END PROMPT ===\n")
            return

        if not os.environ.get("OPENAI_API_KEY"):
            raise SystemExit("OPENAI_API_KEY is required (set in workspace .env)")

        print(
            f"  {review_key}: gap={pct(gap)} "
            f"baseline={baseline['method']}/{baseline['model']} score={pct(baseline['score'])}"
        )
        raw = call_llm(prompt, model=args.model)
        explanation = parse_json_response(raw)
        if not explanation:
            print(f"    warning: failed to parse JSON, storing raw text")
            explanation = {"headline": "Parse error", "summary": raw[:500], "raw": raw}

        results[review_key] = {
            "review_key": review_key,
            "product_description": entry.get("product_description", ""),
            "sapiens_overall_similarity": hc_scores.get(review_key),
            "sapiens_baseline_gap": gap,
            "best_baseline": {
                "method": baseline["method"],
                "model": baseline["model"],
                "overall_similarity": baseline["score"],
                "review_text": baseline["review_text"],
                "themes": baseline.get("themes"),
                "sentiment": baseline.get("sentiment"),
            },
            "explanation": explanation,
        }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(results)} explanations to {OUT_PATH}")


if __name__ == "__main__":
    main()
