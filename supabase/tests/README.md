# Database checks

Run in the Supabase SQL editor (or the agent's `execute_sql`), as `postgres`. Each one
reports expected vs got. They only touch Dockcheck's tables.

| File | Checks | Safe with the worker live? |
|---|---|---|
| `rls.sql` | Two pretend Clerk users and a signed-out visitor: who can read and write each table and call the worker functions | **Yes.** Uses its own `test-*` stations and `user_test_*` trips and deletes them |
| `functions.sql` | `apply_station_information` / `apply_station_status` against the Step 1 samples (fetched from this repo with `pg_net`): only rider-facing changes are written, heartbeats are skipped, re-sending is a no-op, silent flips, unknown ids | **No.** Run only on an empty database (a Supabase branch). It deletes every station at the end, and the live watermark refuses yesterday's samples |

`functions.sql` has two parts because `pg_net` fetches only after the first part commits.

The worker's own logic is tested in Node: `npm run test:worker` (see
`supabase/functions/poll-divvy/*.test.ts`).
