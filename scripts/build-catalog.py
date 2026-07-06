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
from pathlib import Path
from typing import Any

WORKSPACE = Path(__file__).resolve().parents[2]
CLUSTERING = WORKSPACE / "Clustering"
OUTPUTS = WORKSPACE / "outputs"
OUT_DIR = Path(__file__).resolve().parents[1] / "src" / "data"

# 27 cluster_4 tribes + 3 high performers from other clusters
SELECTED_TRIBES: list[tuple[str, str]] = [
    # cluster_4 — all 27 micro-clusters (micro_1 & micro_7 are anchors)
    *[(f"cluster_4", f"micro_{i}") for i in range(27)],
    # +3 from cluster_1 (top recall@k performers)
    ("cluster_1", "micro_9"),
    ("cluster_1", "micro_17"),
    ("cluster_3", "micro_12"),
]

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


def user_similarity_scores(cluster: str, micro: str) -> dict[str, float]:
    """Mean overall_accuracy per user from benchmark predictions."""
    p = CLUSTERING / "Prediction_Accuracy_Refined" / cluster / f"{micro}_summary_enhanced_delta_corrected.json"
    if not p.exists():
        return {}
    data = load_json(p)
    preds = data.get("user_predictions") or {}
    scores: dict[str, list[float]] = {}
    for uid, reviews in preds.items():
        for rev in reviews:
            acc = (rev.get("metrics") or {}).get("overall_accuracy")
            if acc is not None:
                scores.setdefault(uid, []).append(float(acc))
    return {uid: sum(v) / len(v) for uid, v in scores.items() if v}


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


def build_tribe(cluster: str, micro: str, definitions: list, population_def: str) -> dict | None:
    details_path = CLUSTERING / "micro_cluster_details" / cluster / f"{micro}_details.json"
    if not details_path.exists():
        print(f"  SKIP {cluster}/{micro}: no details file")
        return None

    details = load_json(details_path)
    evo = find_evolution(cluster, micro)
    tribe_def = find_tribe_definition(definitions, cluster, micro)

    if evo:
        tribe_name = evo["tribe_name"] or details.get("persona_name", micro)
        tribe_desc = evo["tribe_description"]
        qualitative = evo["qualitative_summary"]
        trait_source = "evolution_state.json"
    else:
        tribe_name = details.get("persona_name", micro)
        q = details.get("qualitative_summary") or {}
        tribe_desc = q.get("persona_summary", tribe_name)
        qualitative = {
            "inherent_behavioral_traits": [{"text": t} for t in (q.get("core_characteristics") or [])[:8]],
            "latent_motivations": {"main": [{"text": t} for t in (q.get("key_motivations") or [])[:6]]},
            "validation_triggers": q.get("common_praises") or [],
            "friction_points": q.get("common_criticisms") or [],
            "implicit_goals": [{"text": t} for t in (q.get("potential_goals") or [])[:5]],
        }
        trait_source = "micro_cluster_details (seed)"

    members = details.get("member_user_characteristics") or []
    grouped = details.get("members_grouped_by_user") or {}
    char_by_user = {m["user_id"]: m.get("characteristic_summary", "") for m in members}

    users_source = f"Clustering/micro_cluster_details/{cluster}/{micro}_details.json"
    similarity_source = (
        f"Clustering/Prediction_Accuracy_Refined/{cluster}/{micro}_summary_enhanced_delta_corrected.json"
    )
    products_source = users_source

    sgo = load_sgo_reviews(cluster, micro)
    users_out: list[dict] = []

    if sgo:
        sgo_rows, products_source = sgo
        similarity_source = products_source
        by_user: dict[str, list[dict]] = {}
        for row in sgo_rows:
            by_user.setdefault(row["user_id"], []).append(row)

        for uid, reviews in by_user.items():
            mean_sim = sum(r["similarity_score"] for r in reviews) / len(reviews)
            products = [
                {
                    "review_key": r["review_key"],
                    "product_description": r["product_description"],
                    "review_text": r["review_text"],
                    "rating": r["rating"],
                    "category": r["category"],
                    "predicted_themes": r["predicted_themes"],
                    "sentiment": r.get("sentiment"),
                }
                for r in reviews
            ]
            users_out.append(
                {
                    "user_id": uid,
                    "characteristic_summary": char_by_user.get(uid, ""),
                    "similarity_score": round(mean_sim, 4),
                    "products": products,
                }
            )
        users_source = (
            f"Clustering/micro_cluster_details/{cluster}/{micro}_details.json"
            + " (user characteristics)"
        )
    else:
        sim_scores = user_similarity_scores(cluster, micro)
        for m in members:
            uid = m["user_id"]
            reviews = grouped.get(uid) or []
            products = []
            for i, r in enumerate(reviews):
                products.append(
                    {
                        "review_key": f"{uid}_review_{i}",
                        "product_description": r.get("product_description", ""),
                        "review_text": r.get("review_text", ""),
                        "rating": r.get("rating"),
                        "category": r.get("category", "Health & Personal Care"),
                        "predicted_themes": r.get("predicted_themes") or r.get("themes") or [],
                        "sentiment": r.get("sentiment"),
                    }
                )
            users_out.append(
                {
                    "user_id": uid,
                    "characteristic_summary": m.get("characteristic_summary", ""),
                    "similarity_score": round(sim_scores.get(uid, 0.5), 4),
                    "products": products,
                }
            )

    users_out.sort(key=lambda u: u["similarity_score"], reverse=True)

    return {
        "id": f"{cluster}-{micro}",
        "cluster": cluster,
        "micro_id": micro,
        "tribe_name": tribe_name,
        "tribe_description": tribe_desc,
        "tribe_definition": tribe_def,
        "population_definition": population_def,
        "trait_source": trait_source,
        "data_sources": {
            "users": users_source,
            "products": products_source,
            "similarity": similarity_source,
            "traits": trait_source,
        },
        "qualitative_summary": qualitative,
        "member_user_characteristics": [
            {"user_id": u["user_id"], "characteristic_summary": u["characteristic_summary"], "similarity_score": u["similarity_score"]}
            for u in users_out
        ],
        "members_grouped_by_user": {u["user_id"]: u["products"] for u in users_out},
    }


def main() -> None:
    tribe_defs_data = load_json(CLUSTERING / "micro_cluster_tribe_definitions.json")
    definitions = tribe_defs_data.get("definitions") or []

    pop_data = load_json(CLUSTERING / "category_generic_tribe_definitions.json")
    population_def = (
        pop_data.get("definitions", {})
        .get("Health & Personal Care", {})
        .get("tribe_definition", "Health-conscious consumers who evaluate supplements, personal care, and wellness products.")
    )

    tribes_dir = OUT_DIR / "tribes"
    tribes_dir.mkdir(parents=True, exist_ok=True)

    index = []
    built = 0
    for cluster, micro in SELECTED_TRIBES:
        print(f"Building {cluster}/{micro}...")
        tribe = build_tribe(cluster, micro, definitions, population_def)
        if not tribe:
            continue
        out_path = tribes_dir / f"{tribe['id']}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(tribe, f, ensure_ascii=False)
        index.append({
            "id": tribe["id"],
            "name": tribe["tribe_name"],
            "cluster": cluster,
            "microId": micro,
            "description": tribe["tribe_description"][:200] + "…" if len(tribe["tribe_description"]) > 200 else tribe["tribe_description"],
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
        })
        built += 1
        print(f"  -> {tribe['tribe_name']} ({len(tribe['member_user_characteristics'])} users, traits from {tribe['trait_source']})")

    with open(OUT_DIR / "catalog-index.json", "w", encoding="utf-8") as f:
        json.dump({"tribes": index, "total": built}, f, ensure_ascii=False, indent=2)

    print(f"\nDone: {built} tribes written to {tribes_dir}")


if __name__ == "__main__":
    main()
