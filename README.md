# Dockcheck

**Divvy bike-share, answered for your trips.** Follow the trips you actually make
("Home → the Reg") and see, live, whether there's a bike at the start **and** a free dock
at the end, with backups nearby when there isn't.

**Live: https://dockcheck-flame.vercel.app** · MPCS 51238 *Design, Build, Ship*, Assignment 5:
Live Data System.

```
Divvy GBFS ──► worker (Supabase Edge Function, Supabase Cron every 10 s)
           ──► Supabase Postgres (writes only rows that changed; one row per run)
           ──► Supabase Realtime ──► page on Vercel (updates without a refresh)
```

## It works

Over its first 16.8 hours the worker ran **6,032 times** (one every 10 s). **83.4%** of runs
found Divvy's feed unchanged and wrote nothing. The rest wrote only real changes:
**38,061** station rows in total, against ~12.5 million if every run rewrote all 2,079
stations. The only failures were 8 runs during a deliberate 70 s function swap, each
recorded with its reason.

## Read in order

| | |
|---|---|
| [`docs/01-live-source.md`](docs/01-live-source.md) | Divvy's feed, called twice; what changes and what's a heartbeat |
| [`docs/02-agent-access.md`](docs/02-agent-access.md) | MCP servers and CLIs, each checked |
| [`docs/03-data-flow.md`](docs/03-data-flow.md) | The chart, drawn before any code |
| [`docs/04-schema.md`](docs/04-schema.md) | Tables, RLS and Realtime, tested as two users |
| [`docs/05-worker.md`](docs/05-worker.md) | The worker, its live runs, and an independent Codex review |
| [`docs/06-page.md`](docs/06-page.md) | The page: live updates, loading / fresh / stale / down, design rules |

## Where things are

| | |
|---|---|
| `supabase/functions/poll-divvy/` | The worker (Deno) + 20 tests run with Node |
| `supabase/migrations/` | Every schema change, in order |
| `supabase/tests/` | SQL checks for RLS and the worker functions |
| `app/`, `components/`, `lib/` | The page; `lib/verdict.ts` and `lib/freshness.ts` are tested |
| `scripts/contrast.mjs` | Checks every color pair against WCAG AA |

## Run it

```
npm install
npm run dev      # needs .env.local: Clerk keys + NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY
npm test         # 37 tests (page logic + worker)
npm run build
npm run lint
```

Keys live in `.env.local`, Vercel and Supabase, never in code.
