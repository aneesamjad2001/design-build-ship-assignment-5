# Dockcheck — project context

Divvy bike-share, answered for *your* trips. A person follows the trips they actually
make ("Home → the Reg") and sees, live and at a glance, whether there's a bike at the
start **and** a free dock at the end, with backups nearby when there isn't.
MPCS 51238 *Design, Build, Ship*, Assignment 5: Live Data System.

## The system (the point of this assignment)
Divvy GBFS feed → **worker** (Supabase Edge Function, run by Supabase Cron every ~10 s)
→ **Supabase Postgres** (upsert only rows that changed, one row per run in a runs table)
→ **Supabase Realtime** → **page** on Vercel that updates without a refresh.

## Hard constraints (from the assignment)
- Next.js + Tailwind, **Clerk** for sign-in, **Supabase** for the database, Realtime and
  the worker. Page on Vercel's free Hobby plan. Free tiers only.
- The worker is an Edge Function in `supabase/functions/` (Deno, not Node). `supabase`
  is in `tsconfig.json`'s `exclude` so the Next.js build doesn't type-check it.
- The worker saves **only what changed** (upsert) and records every run (when, ok or not,
  how many rows changed). It writes with the Supabase secret key that Supabase injects on
  its servers; the key never appears in code or commits.
- Realtime needs all three: the table in the `supabase_realtime` publication, `select`
  granted, and an RLS policy that lets the person read it. Missing one = silence, no error.
- Each person chooses what they follow; their choices have RLS (`user_id` = Clerk `sub`).
- The page shows how fresh the data is and has designed **loading / fresh / stale / down**
  states.
- Keys live in `.env.local` / Vercel / Supabase secrets, never in code. The agent is denied
  read access to `.env*` (`.claude/settings.json`); the author writes that file.
- Schema changes are **migrations** in `supabase/migrations/`, never ad hoc edits.
- **Shared Supabase project:** this app lives in the "Design, Build, Ship" project next to
  Assignment 4 (Ironlog). Never touch Ironlog's tables (`profiles`, `workouts`, `checkins`,
  `saved_exercises`) or its policies.
- Not a one-shot: work step by step, commit as you go, and record each "Ask your agent"
  answer in `docs/`.

## The source: Divvy GBFS v1.1 (no key)
Details and samples: `docs/01-live-source.md`, `docs/source-samples/`.
- `station_status.json` (2,079 stations, `ttl` 60 s) is live; `station_information.json`
  (names, lat/lon, capacity, type) changes on the scale of days.
- `last_reported` is a **heartbeat**: in 6 minutes it moved for 1,157 stations but counts
  changed for only 153. A row is "changed" only when a rider-facing field changed.
- `num_bikes_available` **includes** e-bikes; classic = bikes − ebikes.
- 902 stations are `lightweight` (e-bike lock-ups, mostly capacity 0) and often haven't
  reported in months. Staleness is per station as well as per feed.

## Design rules (from TA feedback on Assignments 3 and 4)
- **Glanceable, phone-first.** People check this on the way out the door. The answer is
  one big word and one number; no paragraph to read.
- **Choices differ in words**, not only in color or pictures. Status is never color alone.
- **No surprise UI.** Nothing appears that the person didn't ask for unless it says why.
- **Remember what people tell you** (their trips, labels, backups).
- **Motion explains change:** a value that just updated briefly highlights (respect
  reduced motion).
- Every control that looks clickable does something; every choice visibly changes what
  it says it changes.
- Forms: one column, a real label on every field, errors next to the field, keep what
  was typed. Keyboard works everywhere; contrast is checked, not assumed.

## Commands
`npm run dev` · `npm run build` · `npm run lint`

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
