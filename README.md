# TopDown

**Org charts that build themselves.** Paste a company domain → get an AI-researched
stakeholder map in ~60 seconds → manipulate it on a canvas → share a live link.

Deployed at [topdown.sh](https://topdown.sh) — Vercel (web + serverless API) + Vercel Postgres.

Built for sales teams mapping buying committees — champions, economic buyers,
blockers, and the reporting lines between them.

## Product shape

- **Research engine (T0)** — public-web research (leadership pages, press,
  job postings, SEC filings) via an LLM provider. Works with zero integrations.
  Tiered enrichment (The Org → Apollo/LeadIQ → CRM) deepens maps when a
  workspace plugs in keys — see `docs/plan` in the PR for the tier model.
- **Canvas** — infinite canvas, person nodes with role badges
  (Champion / Economic Buyer / Decision Maker / Blocker / Influencer),
  formal reporting edges + informal influence edges, auto tree layout.
- **Team** — workspaces with members; maps are shared team objects.
- **Share links** — live read-only links for champions, execs, and QBR decks.
- **Export** — one-click PNG for decks and reviews.

## Stack

| Piece | Choice |
|---|---|
| `web/` | React 18 + TypeScript + Vite + Tailwind + Zustand + React Flow |
| `api/` | Hono + Postgres — `api/[...route].ts` is the Vercel serverless entry, `_src/serve.ts` is the local dev server |
| LLM | OpenRouter (primary, `OPENROUTER_API_KEY`) → Perplexity → Gemini → demo fixture |

## Dev

```bash
npm install
cp .env.example .env        # MONGODB_URI + at least one LLM key
npm run dev                 # api :8787  +  web :5173 (proxies /api)
```

Open http://localhost:5173 — register an account (creates a personal
workspace), then "New map" → paste a domain.

## Notes

- Auth is minimal email/password + session cookie — structured to swap in
  WorkOS/SSO later.
- Secrets never live in the repo; `.env` is gitignored.
