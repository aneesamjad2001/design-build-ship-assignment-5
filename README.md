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

## What you see

- **Each trip, one big word:** *Go*, *Tight*, *No bikes*, *No docks*, *Closed* or *Unsure*,
  with the one number that matters and backups (with walking time) when there's a problem.
- **Where it's heading:** a one-hour sparkline per end, *−4 bikes in 15 min*, and
  *At this pace, out of bikes in ~11 min* when it's about to run out.
- **How fresh it is, always:** *Live · Divvy updated 40 s ago*, or *Stale* / *Down* /
  *Reconnecting* with the reason in words.
- **Under the hood** (`/system`): the whole pipeline running live, and every run arriving
  every 10 seconds.

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
npm test         # 43 tests (page logic + worker)
npm run build
npm run lint
```

Keys live in `.env.local`, Vercel and Supabase, never in code.
