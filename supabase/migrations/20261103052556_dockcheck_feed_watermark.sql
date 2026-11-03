-- From the independent review (docs/05-worker.md):
-- 1. Overlapping runs must not write an older feed over a newer one.
-- 2. A station missing from a good feed (dropped, or its row failed validation) must not keep
--    looking live: mark it silent ("not reporting") until it comes back.

-- The newest station_status feed that has been applied. One row.
create table public.feed_state (
  id                 boolean primary key default true check (id),
  status_applied_at  timestamptz,   -- Divvy last_updated of the newest applied feed
  updated_at         timestamptz not null default now()
);
insert into public.feed_state default values;

comment on table public.feed_state is
  'Dockcheck: watermark of the newest Divvy feed applied, so an overlapping slower run cannot roll counts back.';

-- Worker-only bookkeeping: nobody else reads or writes it.
alter table public.feed_state enable row level security;
revoke all on public.feed_state from anon, authenticated;
grant all on public.feed_state to service_role;

-- Replace the one-argument version.
drop function public.apply_station_status(jsonb);

-- Returns {"changed": n, "unknown": n, "missing": n, "stale": bool}.
--   stale   = this feed is older than one already applied; nothing was written.
--   missing = stations that were reporting but aren't in this feed; now marked silent
--             (also counted in changed).
create function public.apply_station_status(p_rows jsonb, p_feed_updated_at timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_watermark timestamptz;
  v_changed   integer;
  v_missing   integer;
  v_unknown   integer;
begin
  if p_feed_updated_at is null then
    raise exception 'p_feed_updated_at is required';
  end if;

  -- One writer at a time, and the watermark read happens under the lock.
  perform pg_advisory_xact_lock(hashtext('dockcheck.apply_station_status'));

  select status_applied_at into v_watermark from public.feed_state where id;
  if v_watermark is not null and p_feed_updated_at < v_watermark then
    return jsonb_build_object('changed', 0, 'unknown', 0, 'missing', 0, 'stale', true);
  end if;

  with incoming as (
    select r.*,
           coalesce(r.reported_at < now() - interval '60 minutes', true) as silent
    from jsonb_to_recordset(p_rows) as r(
      station_id text, bikes integer, ebikes integer, docks integer,
      bikes_disabled integer, docks_disabled integer,
      is_installed boolean, is_renting boolean, is_returning boolean,
      reported_at timestamptz
    )
  ),
  diff as (
    select i.*,
           s.bikes as old_bikes, s.ebikes as old_ebikes, s.docks as old_docks,
           (s.bikes, s.ebikes, s.docks)
             is distinct from (i.bikes, i.ebikes, i.docks) as counts_changed
    from incoming i
    join public.stations s using (station_id)
    where (s.bikes, s.ebikes, s.docks, s.bikes_disabled, s.docks_disabled,
           s.is_installed, s.is_renting, s.is_returning, s.silent)
          is distinct from
          (i.bikes, i.ebikes, i.docks, i.bikes_disabled, i.docks_disabled,
           i.is_installed, i.is_renting, i.is_returning, i.silent)
  ),
  updated as (
    update public.stations s
       set bikes = d.bikes,
           ebikes = d.ebikes,
           docks = d.docks,
           bikes_disabled = d.bikes_disabled,
           docks_disabled = d.docks_disabled,
           is_installed = d.is_installed,
           is_renting = d.is_renting,
           is_returning = d.is_returning,
           reported_at = d.reported_at,
           silent = d.silent,
           status_changed_at = now()
      from diff d
     where s.station_id = d.station_id
    returning 1
  ),
  went_missing as (
    -- Had live data, isn't in this feed: we no longer know its counts.
    update public.stations s
       set silent = true,
           status_changed_at = now()
     where not s.silent
       and s.bikes is not null
       and not exists (select 1 from incoming i where i.station_id = s.station_id)
    returning 1
  ),
  logged as (
    insert into public.station_changes
      (station_id, bikes_before, bikes_after, ebikes_before, ebikes_after, docks_before, docks_after)
    select station_id, old_bikes, bikes, old_ebikes, ebikes, old_docks, docks
    from diff
    where counts_changed
      and old_bikes is not null   -- first sighting fills the row; it isn't a change
    returning 1
  )
  select (select count(*) from updated), (select count(*) from went_missing)
    into v_changed, v_missing;

  select count(*) into v_unknown
  from jsonb_to_recordset(p_rows) as r(station_id text)
  where not exists (select 1 from public.stations s where s.station_id = r.station_id);

  -- Equal is allowed: the same run re-applies after learning new stations.
  update public.feed_state
     set status_applied_at = greatest(coalesce(status_applied_at, p_feed_updated_at), p_feed_updated_at),
         updated_at = now()
   where id;

  return jsonb_build_object(
    'changed', v_changed + v_missing,
    'unknown', v_unknown,
    'missing', v_missing,
    'stale',   false
  );
end;
$$;

revoke execute on function public.apply_station_status(jsonb, timestamptz) from public, anon, authenticated;
grant  execute on function public.apply_station_status(jsonb, timestamptz) to service_role;

-- Seed the watermark from what has already been applied.
update public.feed_state
   set status_applied_at = (select max(feed_updated_at) from public.worker_runs where ok and not feed_unchanged)
 where id;
