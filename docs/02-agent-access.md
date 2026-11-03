# Step 2: what the agent can reach, and proof that each one works

Checked Mon Nov 2, 2026, ~10:00 PM, from Claude Code in this repo. Each row says what
the tool is for in Dockcheck and what was run to show it works. The agent cannot read
`.env*` (`.claude/settings.json` denies it), so no check below used a secret from there.

## Ask your agent: "Which MCP servers and CLIs can you use in this project, what would you use each one for, and does each one work?"

### MCP servers

| Server | Use in Dockcheck | Check run | Result |
|---|---|---|---|
| **Supabase** (`.mcp.json`, project `jdbvghqeemcduoeubtmp`, writes on) | Apply migrations, run SQL to inspect tables / RLS / the Realtime publication, deploy the `poll-divvy` Edge Function, set its secrets, read its logs, run the security and performance advisors, search the Supabase docs | `get_project_url`, `list_tables`, `list_migrations`, `list_edge_functions`, `list_extensions`, `execute_sql` (read-only), `search_docs` | **Works.** URL `https://jdbvghqeemcduoeubtmp.supabase.co`. Tables: only Ironlog's 4 (`profiles`, `workouts`, `checkins`, `saved_exercises`), which we must not touch. Migrations: Ironlog's 3. Edge Functions: none yet. SQL runs as `postgres` on Postgres 17.11. |

Other connectors are attached to this Claude account (Gmail, Slack, Google Calendar /
Drive, Granola, Lucid, Claude Docs). Dockcheck doesn't use them, so the agent won't call
them for this assignment.

### CLIs

| CLI | Use in Dockcheck | Check run | Result |
|---|---|---|---|
| **git** 2.39.5 | Commit each step as it's done | `git remote -v` | **Works.** `origin` = github.com/aneesamjad2001/design-build-ship-assignment-5 |
| **gh** 2.96.0 | Push, read the repo, link it to Vercel | `gh auth status` | **Works.** Logged in as `aneesamjad2001`, scope `repo` |
| **node** 26.11.1 / **npm** 11.20.0 | `npm run dev / build / lint`; run the worker's pure parse-and-diff code against `docs/source-samples/` with `node --test` (no Deno needed for that part) | `--version` | **Works** |
| **Clerk CLI** 4.1.0 (`npx clerk`) | Pull Clerk keys into `.env.local` (the author runs this), check the app setup | `npx clerk whoami` | **Works.** `aneesamjad@uchicago.edu`, app *Dockcheck* `app_3La0Tbit2JzricbNW2y3YSBOoMw`, development instance only, linked to this repo |
| **psql** 17.11 | Spare: direct SQL if the MCP is down | `--version` | **Installed** (no connection string here, on purpose) |
| **curl** | Call the live source | `station_status.json` | **Works.** 2,079 stations, `ttl` 60, `last_updated` 04:54:41 UTC |
| **Codex CLI** 0.162.1 | Independent review of the worker, RLS and Realtime setup by a different model | `codex exec -s read-only "Reply with exactly: codex ok"` | **Works.** Logged in with ChatGPT, replied `codex ok` |
| **Supabase CLI** 3.0.0 (`npx supabase`) | Not needed: the MCP covers migrations, deploys, secrets and logs | `npx supabase projects list` | **Runs, not logged in** (`AccessTokenRequiredError`). Left that way. |
| **Vercel CLI** 65.10.0 (`npx vercel`) | Set env vars on Vercel, read build logs, check the deployed URL | `npx vercel whoami`, `npx vercel teams ls` | **Works** after the author ran `! npx vercel login` (device code in the browser): `aneesamjad2001`, team *Anees* on the **Hobby** (free) plan. |
| **Deno** | Run the Edge Function locally | `command -v deno` | **Not installed.** Not needed: the function is tested in two parts, the logic with Node against fixtures and the deployed function by calling it and reading `worker_runs`. |

## What the checks found that the next step must fix

1. **`pg_cron` and `pg_net` are not enabled.** Supabase Cron needs both (`pg_cron`
   schedules the job, `pg_net` makes the HTTP call to the worker). The first migration
   enables them.
2. **The `supabase_realtime` publication exists but has no tables in it.** Ironlog
   never used Realtime. The migration adds `stations` and `worker_runs`. Without that,
   Realtime sends nothing and shows no error.
3. **Clerk has only a development instance.** That's fine for the class demo. It means
   the sign-in page shows Clerk's "development mode" badge.
4. **`supabase_vault` is already installed**, so the worker's secret for the cron call
   can live in Vault, not in code.

## AGENTS.md is loaded

`/context` at the start of this session lists the project file under *Memory files*:

```
Memory files · /memory
├ ~/.claude/projects/-Users-aneesamjad-design-build-ship-assignment-5/memory/MEMORY.md: 121 tokens
└ AGENTS.md: 1.6k tokens
```

Screenshot: [`02-context.png`](./02-context.png) (added by the author).
