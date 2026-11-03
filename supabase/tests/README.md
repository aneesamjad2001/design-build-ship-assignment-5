# Database checks

Run in the Supabase SQL editor (or the agent's `execute_sql`), as `postgres`. Each one
reports expected vs got and cleans up after itself. They only touch Dockcheck's tables.

| File | Checks |
|---|---|
| `functions.sql` | `apply_station_information` / `apply_station_status` against the Step 1 samples (fetched from this repo with `pg_net`): only rider-facing changes are written, heartbeats are skipped, re-sending is a no-op, silent flips, unknown ids |
| `rls.sql` | Two pretend Clerk users and a signed-out visitor: who can read and write each table and call the worker functions |

`functions.sql` has two parts because `pg_net` fetches only after the first part commits.
Both expect the Dockcheck tables to be empty (run them before the worker is scheduled,
or pause the cron job first).
