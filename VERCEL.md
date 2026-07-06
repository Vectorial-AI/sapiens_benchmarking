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

- `src/data/catalog-index.json` — 30 tribes
- `src/data/tribes/*.json` — users, products, evolved traits
- `src/data/benchmark-metrics.json` — aggregated Sapiens vs baseline scores
- `src/lib/prompts.ts` — history / tribe / population / Sapiens prompts

## Regenerate catalog (local only)

After pipeline updates, run locally then commit:

```bash
python3 scripts/build-catalog.py
# Re-export metrics if needed:
python3 -c "..."  # see scripts/build-catalog.py header
```

## API routes

| Route | Purpose |
|-------|---------|
| `GET /api/catalog` | Tribe index |
| `GET /api/tribe/[id]` | Full tribe + users |
| `POST /api/run` | Baseline vs Sapiens LLM comparison |
| `GET /api/benchmark` | Aggregated metrics |
| `POST /api/analyze` | Fidelity scoring |

`/api/run` has `maxDuration: 120s` (requires Vercel Pro for >60s on some plans).
