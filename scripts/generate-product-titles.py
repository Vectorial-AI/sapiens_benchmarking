#!/usr/bin/env python3
"""Generate short static product titles from catalog product_description via gpt-4o-mini."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "src" / "data"
TRIBES_DIR = DATA_DIR / "tribes"
OUTPUT_PATH = DATA_DIR / "product_titles.json"

PRODUCT_TITLES_MODEL = "gpt-4o-mini"
MAX_DESC_CHARS = 1200


def load_catalog_products() -> list[dict]:
    rows: list[dict] = []
    seen: set[str] = set()
    for path in sorted(TRIBES_DIR.glob("cluster_*-micro_*.json")):
        tribe = json.loads(path.read_text(encoding="utf-8"))
        if tribe.get("domain") != "video_games":
            continue
        for prods in (tribe.get("members_grouped_by_user") or {}).values():
            for product in prods:
                review_key = str(product.get("review_key") or "").strip()
                description = str(product.get("product_description") or "").strip()
                if not review_key or not description or review_key in seen:
                    continue
                seen.add(review_key)
                rows.append(
                    {
                        "review_key": review_key,
                        "product_description": description,
                        "category": str(product.get("category") or "").strip(),
                        "domain": str(tribe.get("domain") or "").strip(),
                    }
                )
    return rows


def load_existing_titles() -> dict[str, str]:
    if not OUTPUT_PATH.is_file():
        return {}
    data = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    raw = data.get("titles") if isinstance(data, dict) else data
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v).strip() for k, v in raw.items() if str(v).strip()}


def fallback_title(description: str) -> str:
    text = re.sub(r"\s+", " ", description).strip()
    if text.lower().startswith("product description "):
        text = text[len("Product Description ") :].strip()
    for sep in (". ", " — ", " - ", " | ", "\n"):
        if sep in text:
            candidate = text.split(sep, 1)[0].strip()
            if 12 <= len(candidate) <= 140:
                return candidate
    if len(text) <= 140:
        return text
    cut = text[:137].rstrip()
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut + "…"


def call_openai(system: str, prompt: str) -> str:
    try:
        from openai import OpenAI
    except ImportError as exc:
        raise RuntimeError("Install openai: pip install openai") from exc

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=PRODUCT_TITLES_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
    )
    return (response.choices[0].message.content or "").strip()


def normalize_title(raw: str) -> str:
    title = re.sub(r"\s+", " ", raw).strip().strip('"').strip("'")
    title = re.sub(r"^(title|product)\s*:\s*", "", title, flags=re.I).strip()
    if len(title) > 160:
        title = title[:157].rstrip()
        if " " in title:
            title = title.rsplit(" ", 1)[0]
        title = title + "…"
    return title


def generate_title(row: dict, *, use_llm: bool) -> str:
    description = row["product_description"]
    if not use_llm:
        return fallback_title(description)

    system = (
        "You write descriptive product titles for a benchmarking catalog UI. "
        "Return only the title text — no quotes, labels, or extra commentary."
    )
    prompt = f"""Write a descriptive product title (about 12–20 words, max 160 characters) that tells a shopper what this item is.

Rules:
- Include product type, brand or franchise name, platform/format when obvious, and one key detail (edition, bundle, or main feature).
- Aim for a fuller catalog-style title — not a one-liner, but still not a paragraph.
- Do NOT paste marketing fluff, legal text, or long spec lists.
- Do NOT start with "Product Description".
- Plain text only.

Category: {row.get("category") or "Unknown"}
Domain: {row.get("domain") or "Unknown"}

Product description:
{description[:MAX_DESC_CHARS]}"""

    raw = call_openai(system, prompt)
    title = normalize_title(raw)
    return title or fallback_title(description)


def save_titles(titles: dict[str, str], *, model: str, source: str) -> None:
    payload = {
        "model": model,
        "source": source,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "titles": dict(sorted(titles.items())),
    }
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate static catalog product titles.")
    parser.add_argument("--dry-run", action="store_true", help="Use local fallback titles only.")
    parser.add_argument("--force", action="store_true", help="Regenerate all titles.")
    parser.add_argument("--limit", type=int, default=0, help="Only process N missing titles.")
    args = parser.parse_args()

    products = load_catalog_products()
    existing = {} if args.force else load_existing_titles()
    use_llm = not args.dry_run and bool(os.environ.get("OPENAI_API_KEY", "").strip())
    if not args.dry_run and not use_llm:
        print("OPENAI_API_KEY not set — using fallback titles.", file=sys.stderr)

    titles = dict(existing)
    pending = [row for row in products if row["review_key"] not in titles]
    if args.limit > 0:
        pending = pending[: args.limit]

    print(f"Catalog products: {len(products)} unique review keys")
    print(f"Existing titles: {len(existing)}")
    print(f"To generate: {len(pending)}")

    for idx, row in enumerate(pending, start=1):
        review_key = row["review_key"]
        try:
            title = generate_title(row, use_llm=use_llm)
        except Exception as exc:
            print(f"  [{idx}/{len(pending)}] {review_key}: error ({exc}), fallback", file=sys.stderr)
            title = fallback_title(row["product_description"])
        titles[review_key] = title
        print(f"  [{idx}/{len(pending)}] {review_key}: {title}")
        if use_llm and idx < len(pending):
            time.sleep(0.15)

    model = PRODUCT_TITLES_MODEL if use_llm else "fallback"
    source = "catalog tribes product_description"
    save_titles(titles, model=model, source=source)
    print(f"\nWrote {len(titles)} titles to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
