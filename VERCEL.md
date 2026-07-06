# Sapiens Benchmark — Vercel deployment

## Deploy

1. Push `sapiens_benchmarking-main` to GitHub
2. Import project in [Vercel](https://vercel.com/new) — set **Root Directory** to `sapiens_benchmarking-main`
3. Add environment variables (Project → Settings → Environment Variables):

| Variable | Required | Purpose |
|----------|----------|---------|
| `AI_GATEWAY_API_KEY` | Yes* | Live LLM calls via Vercel AI Gateway |
| `VERCEL_OIDC_TOKEN` | Auto on Vercel | Alternative auth when deployed on Vercel |

\* Without a gateway key the app returns **mock reviews** (demo mode).

4. Deploy — Vercel runs `npm run build` automatically.

## What's bundled

All runtime data lives under `src/data/` — **the deployed app never reads `outputs/` or `Clustering/`**.

- `src/data/catalog-index.json` — 30 tribes
- `src/data/tribes/*.json` — users, products, evolved traits, ground-truth reviews
- Each product may include `best_prediction_review` — copied from `best_delta_predictions.json` at catalog build time
- `src/data/benchmark-metrics.json` — aggregated Sapiens vs baseline scores
- `src/lib/prompts.ts` — Sapiens / baseline prompt builders

When a product has `best_prediction_review`, Sapiens prompt **Section 4** is:

> SGO Best-Delta Prediction (reference)

…asking the model to write something similar in tone, length, and structure.

## Regenerate catalog (local only)

After pipeline updates, run locally then **commit** the generated JSON:

```bash
cd sapiens_benchmarking-main
python3 scripts/build-catalog.py
git add src/data/
```

`build-catalog.py` reads local paths such as:

- `outputs/amazon_sgo_health_care/{cluster}/{micro}/best_delta_predictions.json`
- `Clustering/micro_cluster_details/...`
- `Clustering/Prediction_Accuracy_Refined/healthcare_digital_technical_accuracy.json`

Those files are **not** available on Vercel. Their contents must be baked into `src/data/tribes/*.json` before deploy.

## API routes

| Route | Purpose |
|-------|---------|
| `GET /api/catalog` | Tribe index |
| `GET /api/tribe/[id]` | Full tribe + users |
| `POST /api/run` | Baseline vs Sapiens LLM comparison |
| `GET /api/benchmark` | Aggregated metrics |
| `POST /api/analyze` | Fidelity scoring |

`/api/run` has `maxDuration: 120s` (requires Vercel Pro for >60s on some plans).

## Prompt context logs

Each Sapiens run logs structured context to **Vercel function logs**. Search for `[sapiens-prompt]`:

1. Vercel → Project → **Logs** (or a deployment → **Functions** → `/api/run`)
2. Run Sapiens in the app
3. Filter/search: `sapiens-prompt`

The log includes checklist flags (tribe trait groups present, user characteristics, prior reviews), trait counts, user-characteristics preview, and prior-review count/previews.

**Full prompt text** (chunked if long) — search these tags after a run:

| Search tag | Prompt |
|------------|--------|
| `prompt-full:system` | Shared system message |
| `prompt-full:sapiens` | Full Sapiens user prompt |
| `prompt-full:baseline:history` | History baseline |
| `prompt-full:baseline:tribe_persona` | Tribe persona baseline |
| `prompt-full:baseline:population_persona` | Population persona baseline |

Running **Sapiens once** logs all four user prompts plus the system message. Running a **baseline** logs that baseline’s full prompt only.

Optional curl (summary, no full text): `GET /api/prompt-context?tribeId=...&userId=...&reviewKey=...&category=...`
