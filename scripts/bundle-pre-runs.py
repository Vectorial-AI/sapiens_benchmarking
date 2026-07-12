#!/usr/bin/env python3
"""Bundle blind i2 pre_runs into src/data/pre_runs for Vercel (showcase products only)."""

from __future__ import annotations

import json
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[2]
APP = Path(__file__).resolve().parents[1]
OUTPUTS = WORKSPACE / "outputs" / "amazon_sgo_health_care"
TRIBES_DIR = APP / "src" / "data" / "tribes"
OUT_ROOT = APP / "src" / "data" / "pre_runs"

SHOWCASE_TRIBES = [
    ("cluster_0", "micro_0"),
    ("cluster_0", "micro_9"),
    ("cluster_0", "micro_11"),
]
PRE_RUN_COUNT = 3


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def showcase_review_keys(cluster: str, micro: str) -> set[str]:
    tribe_path = TRIBES_DIR / f"{cluster}-{micro}.json"
    if not tribe_path.is_file():
        return set()
    data = load_json(tribe_path)
    keys: set[str] = set()
    for products in (data.get("members_grouped_by_user") or {}).values():
        for product in products:
            if product.get("video_games_benchmark"):
                review_key = str(product.get("review_key") or "").strip()
                if review_key:
                    keys.add(review_key)
    return keys


def filter_blind_run(doc: dict, allowed: set[str]) -> dict:
    users: dict[str, list] = {}
    for user_id, rows in (doc.get("user_predictions") or {}).items():
        kept = []
        for row in rows or []:
            review_key = str(row.get("review_key") or "").strip()
            if review_key in allowed:
                kept.append(row)
        if kept:
            users[user_id] = kept
    return {"user_predictions": users}


def filter_deltas(doc: dict, allowed: set[str]) -> dict:
    deltas = []
    for row in doc.get("deltas") or []:
        review_key = str(row.get("review_key") or "").strip()
        if review_key in allowed:
            deltas.append(row)
    return {"deltas": deltas}


def bundle_tribe(cluster: str, micro: str) -> int:
    allowed = showcase_review_keys(cluster, micro)
    if not allowed:
        print(f"  skip {cluster}/{micro}: no showcase keys")
        return 0

    written = 0
    for pre_run_index in range(1, PRE_RUN_COUNT + 1):
        src_dir = OUTPUTS / cluster / micro / "pre_runs" / f"pre_run_{pre_run_index}"
        blind_src = src_dir / "blind_run_i2.json"
        deltas_src = src_dir / "i0_deltas_blind_run_i2.json"
        if not blind_src.is_file():
            print(f"  missing {blind_src}")
            continue

        blind = filter_blind_run(load_json(blind_src), allowed)
        deltas = (
            filter_deltas(load_json(deltas_src), allowed)
            if deltas_src.is_file()
            else {"deltas": []}
        )

        out_dir = OUT_ROOT / cluster / micro / f"pre_run_{pre_run_index}"
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "blind_run_i2.json").write_text(
            json.dumps(blind, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (out_dir / "i0_deltas_blind_run_i2.json").write_text(
            json.dumps(deltas, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        pred_count = sum(len(v) for v in blind["user_predictions"].values())
        written += 1
        print(
            f"  {cluster}/{micro}/pre_run_{pre_run_index}: "
            f"{pred_count} predictions, {len(deltas['deltas'])} deltas"
        )
    return written


def main() -> None:
    print(f"Bundling showcase pre_runs -> {OUT_ROOT.relative_to(APP)}")
    total = 0
    for cluster, micro in SHOWCASE_TRIBES:
        print(f"{cluster}/{micro}")
        total += bundle_tribe(cluster, micro)
    print(f"Done ({total} pre_run folders)")


if __name__ == "__main__":
    main()
