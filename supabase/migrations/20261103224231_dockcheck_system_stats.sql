-- Numbers for the "Under the hood" page: what the worker has done over the runs we keep
-- (7 days), and how many stations are reporting. One small JSON object, so the page never
-- downloads thousands of run rows to add them up. Security invoker: runs with the
-- caller's rights (signed-in people can read these tables).
create function public.dockcheck_system_stats()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'since',        min(r.ran_at),
    'runs',         count(*),
    'failed',       count(*) filter (where not r.ok),
    'applied',      count(*) filter (where r.ok and not r.feed_unchanged),
    'unchanged',    count(*) filter (where r.feed_unchanged),
    'rows_written', coalesce(sum(r.rows_changed), 0),
    'avg_ms',       round(avg(r.duration_ms)),
    'stations',     (select count(*) from public.stations),
    'reporting',    (select count(*) from public.stations where not silent),
    'changes_24h',  (select count(*) from public.station_changes)
  )
  from public.worker_runs r;
$$;

revoke execute on function public.dockcheck_system_stats() from public, anon;
grant  execute on function public.dockcheck_system_stats() to authenticated, service_role;
