# Step 4: the schema, as migrations

Two migrations in [`supabase/migrations/`](../supabase/migrations/), applied to the
shared project on Mon Nov 2, 2026, ~11:05 PM. They follow the chart in
[`03-data-flow.md`](./03-data-flow.md). Ironlog's tables and policies were not touched
(their row counts were the same before and after: 2 profiles, 4 workouts, 2 saved exercises).

| Migration | What it does |
|---|---|
| `20261103050521_dockcheck_init` | Turns on `pg_cron` and `pg_net`. Creates the four tables, grants, RLS policies and the two worker functions. Adds `stations` and `worker_runs` to Realtime. Schedules an hourly cleanup. |
| `20261103050617_dockcheck_advisor_fixes` | Fixes what the Supabase advisors flagged: moves `pg_net` out of `public`, makes the trips policies read the Clerk id once per query, and indexes trips' station keys. |

## Ask your agent: "What does each table hold, who can read and write it, and how do you know?"

| Table | Holds | Signed-in person | Signed out | Worker (secret key) | Realtime |
|---|---|---|---|---|---|
| `stations` | One row per Divvy station: name, place, capacity, type + live bikes / e-bikes / docks / flags, `reported_at`, `silent`, `status_changed_at` | Read | Nothing | Writes, only through the two functions below | **Yes**: an UPDATE when a station changes |
| `station_changes` | Before → after bikes, e-bikes and docks for each change. Deleted after 24 h | Read | Nothing | Writes (inside `apply_station_status`) | No: read on page load for trends |
| `worker_runs` | One row per run: when, ok, rows changed, stations seen, Divvy's `last_updated`, "feed unchanged", duration, error. Deleted after 7 days | Read | Nothing | Inserts one per run | **Yes**: an INSERT per run (the page's freshness clock) |
| `trips` | Each person's followed trips: label, from / to station, up to 3 chosen backups each end | Read, add, edit, delete **only their own** (`user_id` = Clerk `sub`) | Nothing | Not used | No |

**How I know: it was tested, not assumed.** [`supabase/tests/rls.sql`](../supabase/tests/rls.sql)
pretends to be two Clerk users and a signed-out visitor. Every check passed:

| # | Test | Result |
|---|---|---|
| 1 | A adds a trip without giving `user_id` | Filled from A's token: `user_test_a` |
| 2 | A adds a trip claiming to be B | Blocked by RLS |
| 3 | A reuses a label with different case and spaces | Blocked (`trips_user_label`): the form can say *"You already have a trip called that"* |
| 4 | A adds a trip from a station to itself | Blocked (`trip_goes_somewhere`) |
| 5–7 | B lists, edits, deletes A's trip | Sees 0, changes 0 rows, deletes 0 rows |
| 8–9 | B reads stations and worker runs | Allowed |
| 10–12 | B writes a station, calls the worker function, fakes a worker run | All blocked (no permission) |
| 13–14 | Signed-out visitor reads stations or trips | Blocked |
| 15 | A's trip after all of that | Still there, label unchanged |

## The worker functions, tested with the Step 1 samples

The diff happens in Postgres (decision 3 in the data flow). The worker sends every
station. `apply_station_status` updates only rows where a rider-facing field or the
silent flag differs, and logs count changes. Both functions can be called **only** with
the secret key.

[`supabase/tests/functions.sql`](../supabase/tests/functions.sql) fetches the saved
samples from this repo and runs them through. Before running it, I worked out the
expected numbers from the raw files with Node:

| Step | Expected | Got |
|---|---|---|
| Load station info (22 stations) | 22 written | 22 |
| Same info again | 0 | 0 |
| 8:20 PM status, first fill | 22 changed, **0 logged** (empty → filled isn't a change) | 22, 0 |
| 8:27 PM status | **11 changed, 9 logged**. The other 7 stations whose `last_reported` moved were heartbeats only and were skipped. | 11, 9 |
| 8:27 PM again | 0 (nothing new) | 0 |
| One station reports again after silence | 1 changed (silent → live), 0 logged | 1, 0 |
| A station id we don't know | `unknown: 1`, so the worker knows to refresh station info | 1 |
| University Ave & 57th St | bikes 2 → 0, docks 45 → 47 (same as Step 1) | Same |

## Decisions in the schema

- **`silent` is a column the function sets**: true when Divvy's `last_reported` is over
  60 min old. Crossing that line is a real change and is written. A heartbeat isn't.
  So `reported_at` stays honest without a write every minute per station.
- **`status_changed_at`** is when *our* row last changed. It drives *"changed 2 min ago"*
  and the highlight.
- **Overlapping runs can't interleave.** `apply_station_status` takes an advisory lock,
  since a 10 s schedule against a slow Divvy could overlap.
- **Bad data fails loudly, not as zeros.** Counts must be ≥ 0 and e-bikes ≤ bikes. The
  worker also checks each row and drops bad ones, so one odd station can't fail a whole run.
  (Checked against the live feed: 0 of 2,079 stations break these today.)
- **Labels are unique per person**, ignoring case and spaces at the ends.
- **Backups are arrays on the trip** (up to 3 per end). Empty means the page suggests the
  nearest stations and says so.
- **Cleanup runs in `pg_cron`** hourly at :17. The worker's own 10 s schedule is added in
  the next step, once the Edge Function exists.
- **Everything is granted explicitly.** `anon` gets nothing; `authenticated` gets only what
  the table above lists.

## Advisors after both migrations

- Security: **no findings.**
- Performance: only *"unused index"*, because the tables are empty. Re-check after the
  worker has run for a while.
