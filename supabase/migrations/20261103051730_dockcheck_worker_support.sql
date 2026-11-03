-- What the poll-divvy worker needs before it is deployed.

-- 1. Two more facts per run.
alter table public.worker_runs
  add column rows_rejected integer not null default 0 check (rows_rejected >= 0),  -- feed rows that failed validation and were skipped
  add column info_changed  integer check (info_changed >= 0);                      -- null = station info not refreshed this run

comment on column public.worker_runs.info_changed is
  'Rows changed by a station_information refresh in this run; null when no refresh happened.';

-- The worker asks "last ok run's feed time" and "last info refresh" every run.
create index worker_runs_ok_ran_at on public.worker_runs (ran_at desc) where ok;
create index worker_runs_info_ran_at on public.worker_runs (ran_at desc) where info_changed is not null;

-- 2. The secret the cron job sends and the worker checks. Generated here, inside the
--    database, so it never appears in code, commits, or anyone's clipboard.
select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'dockcheck_worker_secret',
  'Sent by the dockcheck cron jobs as x-worker-secret; checked by the poll-divvy Edge Function.'
);

-- The worker (secret key) reads it once per warm instance to compare.
create function public.dockcheck_worker_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'dockcheck_worker_secret';
$$;

revoke execute on function public.dockcheck_worker_secret() from public, anon, authenticated;
grant  execute on function public.dockcheck_worker_secret() to service_role;
