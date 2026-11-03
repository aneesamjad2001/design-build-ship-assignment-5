# Step 5: the worker

`poll-divvy` is a Supabase Edge Function (Deno) in
[`supabase/functions/poll-divvy/`](../supabase/functions/poll-divvy/). Supabase Cron calls
it every 10 s. Live since Mon Nov 2, 2026, 11:21 PM.

| File | Job |
|---|---|
| `divvy.ts` | Reads and validates Divvy's two feeds. Pure: no Deno, no network |
| `run.ts` | One run: fetch → skip if unchanged → apply → record. Everything outside is passed in |
| `index.ts` | Deno wiring: checks the caller's secret, reads the secret key Supabase injects, talks to Divvy and the database |
| `*.test.ts` | 19 tests, run with Node against the Step 1 samples: `npm run test:worker` |

## Ask your agent: "Walk me through one run of the worker. How does it decide what changed, and what happens when something goes wrong?"

**One run, in order:**

1. **Is this caller allowed?** The cron job sends `x-worker-secret`, a random value that
   Postgres generated straight into Vault (migration `…051730`). Nobody has seen it,
   and it isn't in any file. Wrong or missing → `401`, and no run is recorded, because a
   stranger's request isn't the worker failing.
2. **Fetch** `station_status.json` with an 8 s timeout.
3. **Validate every station.** Counts must be whole numbers ≥ 0, e-bikes ≤ bikes, flags
   0/1, and `last_reported` real and not in the future. Every field is **required**:
   Divvy sends all of them for all 2,079 stations, so a missing one means the format
   changed. A bad row is skipped and counted (`rows_rejected`). If more than 10% are bad,
   the run **fails** rather than saving half a feed or zeros.
4. **Same file as last time?** Divvy republishes about every 60 s; we run every 10 s. If
   `last_updated` equals the last ok run's, record `feed_unchanged` and stop. That's 5 of
   every 6 runs, in about 0.1 s.
5. **Apply.** Send every valid station to `apply_station_status(rows, feed_updated_at)`.
   Postgres decides what changed (the Step 3 decision: diff in the database, so we never
   read 2,079 rows back):
   - A row is written **only if a rider-facing field or the silent flag changed**, never
     for a heartbeat.
   - Count changes are logged to `station_changes` (before → after).
   - A station that had data but **dropped out of the feed** is marked *not reporting*.
   - A feed **older than one already applied** is refused (`stale`). That keeps a slow
     overlapping run from rolling counts back.
6. **Unknown stations?** On the first run, or when Divvy adds a station: fetch
   `station_information.json`, save names and places, re-apply. At most once per 15 min,
   plus a forced refresh every hour at :41.
7. **Record the run**, exactly once: when, ok, rows changed, rejected, stations seen,
   Divvy's time, duration, and the error or a note.

**When something goes wrong:**

| What breaks | What the worker does | What the page will see |
|---|---|---|
| Divvy slow (> 8 s) or down | Failed run: *"Divvy didn't answer within 8 s"* / *"Divvy returned HTTP 503"* | **Down**, with the last good numbers |
| Divvy changes the format | > 10% bad rows → failed run naming the count. Nothing written, no zeros | **Down** |
| One odd station | Skipped, counted in `rows_rejected`, run ok. The station is marked *not reporting* | That station: *not reporting* |
| Database rejects the write | Failed run with the database's reason | **Down** |
| Database unreachable, so the run can't be recorded | Logged in the function logs; no row | **Stale** (no new runs), turned on by the page's own clock |
| Cron stops, or the secret is wrong | No runs at all | **Stale**, same way |
| Two runs overlap | The advisory lock serializes them, and the watermark refuses the older feed | Nothing wrong |

## Tested

**Code (Node, 19 tests, all pass):**
- The parser on the real samples. It rejects each kind of bad row, treats a GBFS v3-shaped
  feed as a format error, and refuses missing capacity or type.
- The run logic with a fake Divvy and a fake database: first run on an empty table; 8:20 →
  8:27 saves exactly the 11 changed stations; unchanged feed; Divvy down; format change;
  one odd station; unknown stations; the hourly refresh; an **older feed after a newer one**
  (refused, counts not rolled back); a station that drops out; and a failure while
  recording the run (surfaces once, no invented second run).

**Deployed function (called from Postgres with `pg_net`):**

| Call | Result |
|---|---|
| No secret | `401 Unauthorized`, not recorded |
| Wrong secret | `401 Unauthorized`, not recorded |
| Right secret, empty tables | `200`: learned **2,079** stations and saved their counts in **1.95 s**, 0 rejected |
| An older feed sent straight to the database | `{"stale": true, "changed": 0}`; the station kept its newer count |

**Live, on Supabase Cron** (version 2, 11:28 to 11:31 PM, 19 runs):

| | |
|---|---|
| Runs | 19, all ok, **one every 10.0 s** on average |
| Feed unchanged (nothing to do) | 15 runs, median **110 ms** |
| New feed applied | 4 runs (one a minute, ~11 s after Divvy publishes), median **738 ms** |
| Stations changed per new feed | 8 to 21 (mean 13.5) of 2,079 |
| Not reporting right now | 920 (902 lightweight lock-ups + 18 dock stations, same picture as Step 1) |
| Dockcheck's tables, total | 1.2 MB |

**A real outage, recorded honestly.** Between replacing the database function and
redeploying the worker (about 70 s), 8 runs failed. Each recorded the reason
(`HTTP 404 … apply_station_status`). The next run on the new version recovered on its own
and saved 21 changes. That's the *down* path working end to end.

[`supabase/tests/rls.sql`](../supabase/tests/rls.sql), re-run on the live database:
**17 of 17 pass**. That includes two new checks: a signed-in person can't read the worker
secret or `feed_state`.

## Independent review (Codex)

Codex got the code and the constraints, not my conclusions. Its findings, and what I did:

| # | Finding | Verdict | Done |
|---|---|---|---|
| 1 | Overlapping runs: an older feed could overwrite a newer one | **Real** | Watermark in `feed_state`, checked under the lock; older feeds refused. Tested in Node and live |
| 2 | A station missing from the feed (or rejected) keeps looking live | **Real** | Marked *not reporting* when it's missing from a good feed. Tested |
| 3 | Skipping unchanged feeds delays a station's "silent" flip | Minor | Divvy publishes every ~60 s, so flips happen within a minute. If Divvy stops publishing, the page shows *stale* for everything anyway |
| 4 | A failed run-record write could produce a second, false "failed" run | **Real** | Runs are recorded once, outside the error handling. Tested |
| 5 | Several 8 s timeouts can add up past pg_net's 20 s | Covered by #1 | Overlap is now harmless. Real runs: 0.1–1.4 s |
| 6 | Cached secret survives a rotation; some failures leave no run row | Partly | Secret re-read once on a mismatch. A missing row is exactly what the page's *stale* clock detects |
| 7 | Missing fields became 0 or "classic" | **Real** | Required now (checked against the live feed first) |
| 8 | Dropping `pg_net` could hurt other apps in the shared project | Not here | `pg_net` wasn't installed before Dockcheck enabled it, so nothing else used it |
| Cost | Each open page gets ~260,000 run events a month; 8 always-open pages would use the free 2 M | **Real** | A constraint on the page step, below |

Codex also confirmed: no way for `anon` or `authenticated` to read or write what they
shouldn't; Realtime's three requirements are met for `stations` and `worker_runs`;
the change-detection CTEs are correct on Postgres 17; the secret lookup is narrowly scoped.
The only advisor note is *"`feed_state` has RLS but no policy"*, which is intended
(worker-only table, no grants).

## What the page step must respect

- **Realtime budget.** Don't stream every `worker_runs` insert to every page. Pause the
  subscription while the tab is hidden (as planned), and listen only to runs that changed
  something or failed. The page's own clock already counts silence, so *"checked 6 s ago"*
  stays honest without a message every 10 s.
- **Two clocks.** `ran_at` (*we checked*) and `feed_updated_at` (*Divvy published*), as
  designed in Step 3.
- **Per-station states.** `silent` now covers both *"hasn't reported in 60 min"* and
  *"missing from the feed"*. Both read as *not reporting since …*.

## Schedule (Supabase Cron)

| Job | When | What |
|---|---|---|
| `dockcheck-poll-divvy` | every 10 s | the run above |
| `dockcheck-refresh-info` | hourly at :41 | the same run, with a forced station-info refresh |
| `dockcheck-cleanup` | hourly at :17 | deletes changes > 24 h, runs > 7 days, and Dockcheck's own cron history > 1 day |
