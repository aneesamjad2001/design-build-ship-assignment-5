# Step 7: logs, one traced update, free tiers

The brief's remaining "Ask your agent" prompts, answered from the live system on
Tue Nov 3, 2026, at 5:06 PM.

## Ask your agent: "Show me the worker's logs from its last three runs, and explain each line."

**Supabase's Edge Function log** (`function_edge_logs`), newest first:

```
23:06:17.331Z  POST | 200 | https://jdbvghqeemcduoeubtmp.supabase.co/functions/v1/poll-divvy
23:06:08.137Z  POST | 200 | https://jdbvghqeemcduoeubtmp.supabase.co/functions/v1/poll-divvy
23:05:57.350Z  POST | 200 | https://jdbvghqeemcduoeubtmp.supabase.co/functions/v1/poll-divvy
```

Each line is one call from Supabase Cron (via `pg_net`) to the worker:
- **`POST`**: the cron job's request.
- **`200`**: the secret checked out and the run succeeded. A wrong secret logs `401`; a
  failed run logs `502` with `Run failed: <reason>` in the function's own console log.
- **The URL**: `poll-divvy` on this project.
- **The times**: about 10 s apart, which is the schedule.

The function writes to its console only when something goes wrong, so a healthy run is
just this line. **What each run did** is in the runs table (`worker_runs`), same three
runs:

| Ran (CT) | ok | Rows changed | Feed unchanged | Stations seen | Rejected | Took | Divvy published |
|---|---|---|---|---|---|---|---|
| 5:06:17 PM | yes | 0 | **yes** | 2,079 | 0 | 93 ms | 5:06:04 PM |
| 5:06:08 PM | yes | **150** | no | 2,079 | 0 | 895 ms | 5:06:04 PM |
| 5:05:57 PM | yes | 0 | **yes** | 2,079 | 0 | 81 ms | 5:04:16 PM |

- **5:05:57:** Divvy's newest file was still the one from 5:04:16, already applied. The
  worker recorded "nothing new" and stopped in 81 ms.
- **5:06:08:** Divvy had published at 5:06:04. All 2,079 stations passed validation; the
  database found **150** with a real change (not just a heartbeat) and wrote only those.
- **5:06:17:** the same 5:06:04 file again, so nothing to do (93 ms).

## Ask your agent: "Trace one update for me, from the source to my screen, and name every part it passes through."

A real one: **University Ave & 57th St**, the start of the author's "Home to Reg" trip.

| When (CT) | Part | What happened |
|---|---|---|
| 5:06:04 PM | **Divvy GBFS** (`station_status.json`) | Divvy publishes: this station now has 17 bikes and 29 docks (was 19 and 26) |
| ~5:06:07 | **Supabase Cron** → `pg_net` | The 10 s job calls `poll-divvy` with the `x-worker-secret` header (read from **Vault**) |
| 5:06:07 | **Worker** (`poll-divvy`, Edge Function) | Checks the secret, fetches the feed, validates 2,079 stations, sees a newer `last_updated` than the last run |
| 5:06:07 | **Postgres**: `apply_station_status` | Under the advisory lock, checks the watermark (`feed_state`), compares each station to what's saved, updates 150 rows including this one, logs **19 → 17 bikes, 26 → 29 docks** to `station_changes` |
| 5:06:08 | **Postgres**: `worker_runs` | The run is recorded: ok, 150 changed, 895 ms |
| ~5:06:08 | **Supabase Realtime** | The `stations` UPDATE matches the page's filter (`station_id=in.(…)`); RLS lets this signed-in person read it, so it's pushed down their websocket. The `worker_runs` INSERT (`feed_unchanged=false`) is pushed too |
| ~5:06:08 | **The page** (Vercel, `useDockData`) | Merges the row: **17 bikes** glows for 2.5 s, the sparkline gets a new step, the trend reads *−2 bikes in 15 min*, the verdict is recomputed (*Go*), and the bar resets to *Live · Divvy updated 4 s ago* |

About **4 seconds** from Divvy publishing to the number on screen. Most of that is waiting
for the next 10 s cron tick.

## Ask your agent: "Walk me through the free tier limits for each service my app uses, and how to set usage limits and spending alerts for each one."

| Service | Free limit that matters | Dockcheck's use | Limits and alerts |
|---|---|---|---|
| **Supabase** (Free plan) | 500,000 Edge Function calls a month; 2 M Realtime messages; 500 MB database; 5 GB egress | ~259,000 calls a month (every 10 s + hourly refresh); Realtime filtered to each page's stations and 1 in 6 runs, paused in hidden tabs; tables ~1.2 MB with hourly cleanup | No card on file, so the Free plan can't bill: it **stops** at the limit instead (spend cap). Watch **Organization → Usage**; Supabase emails at 80% / 100% of a quota |
| **Vercel** (Hobby) | 100 GB bandwidth, 1 M function calls a month | One small Next.js app, no server functions besides the proxy | Hobby can't be charged; at the limit it pauses. **Settings → Usage** shows it; enable usage notifications under **Settings → Notifications** |
| **Clerk** (development instance) | 10,000 monthly active users | A class's worth of accounts | No payment method needed; the dashboard's **Usage** page shows active users |
| **Divvy GBFS** | Open data, no key; `ttl` 60 s | One `station_status` call every 10 s; `station_information` hourly | No account. The worker skips unchanged files and sends a `User-Agent` naming the project |
| **GitHub** | Free public repo | Code + history | None needed |

Supabase pauses a free project after a week without use, so the author opens the app now
and then until grades are back.
