-- Dockcheck: first migration.
-- Shared project: Ironlog (A4) owns profiles, workouts, checkins, saved_exercises.
-- Nothing below reads, alters or depends on those tables or their policies.
--
-- Tables
--   stations         one row per Divvy station: slow info + live counts. Realtime.
--   station_changes  one row per rider-visible count change, kept 24 h.
--   worker_runs      one row per worker run: the page's freshness clock. Realtime.
--   trips            what each person follows. RLS: user_id = Clerk sub.
--
-- Writes to stations / station_changes / worker_runs come only from the worker,
-- which uses the secret key (service_role). Signed-in people can only read them.

-- ── Extensions ─────────────────────────────────────────────────────────────
-- pg_cron schedules the worker (and the cleanup job below); pg_net lets the cron
-- job call the Edge Function over HTTP.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

-- ── stations ───────────────────────────────────────────────────────────────
create table public.stations (
  station_id      text primary key,
  -- from station_information.json (changes on the scale of days)
  name            text not null,
  lat             double precision not null,
  lon             double precision not null,
  capacity        integer not null check (capacity >= 0),
  station_type    text not null,            -- 'classic' | 'lightweight' (not enforced: Divvy may add one)
  -- from station_status.json (live). Null until the first status run sees it.
  bikes           integer check (bikes >= 0),          -- num_bikes_available, includes e-bikes
  ebikes          integer check (ebikes >= 0),
  docks           integer check (docks >= 0),
  bikes_disabled  integer check (bikes_disabled >= 0),
  docks_disabled  integer check (docks_disabled >= 0),
  is_installed    boolean,
  is_renting      boolean,
  is_returning    boolean,
  -- Divvy's last_reported, saved only with a real change or a silent flip
  -- (a heartbeat alone is not a change; see docs/03-data-flow.md decision 4).
  reported_at     timestamptz,
  -- true when the station hasn't reported for 60 min. Set by apply_station_status.
  silent          boolean not null default false,
  -- when our row last changed (drives "changed 2 min ago" and the highlight)
  status_changed_at timestamptz,
  info_updated_at timestamptz not null default now(),
  constraint ebikes_within_bikes check (ebikes is null or bikes is null or ebikes <= bikes)
);

comment on table public.stations is
  'Dockcheck: one row per Divvy station. Written only by the poll-divvy worker.';

-- ── station_changes ────────────────────────────────────────────────────────
create table public.station_changes (
  id             bigint generated always as identity primary key,
  station_id     text not null references public.stations (station_id) on delete cascade,
  changed_at     timestamptz not null default now(),
  bikes_before   integer,
  bikes_after    integer,
  ebikes_before  integer,
  ebikes_after   integer,
  docks_before   integer,
  docks_after    integer
);

create index station_changes_station_time on public.station_changes (station_id, changed_at desc);
create index station_changes_time on public.station_changes (changed_at);

comment on table public.station_changes is
  'Dockcheck: before/after counts for each change, for trends. Deleted after 24 h.';

-- ── worker_runs ────────────────────────────────────────────────────────────
create table public.worker_runs (
  id               bigint generated always as identity primary key,
  ran_at           timestamptz not null default now(),
  ok               boolean not null,
  rows_changed     integer not null default 0 check (rows_changed >= 0),
  stations_seen    integer check (stations_seen >= 0),
  feed_updated_at  timestamptz,               -- Divvy's last_updated
  feed_unchanged   boolean not null default false,  -- same last_updated as last ok run: nothing to do
  duration_ms      integer check (duration_ms >= 0),
  error            text,
  constraint error_when_failed check (ok or error is not null)
);

create index worker_runs_ran_at on public.worker_runs (ran_at desc);

comment on table public.worker_runs is
  'Dockcheck: one row per worker run, ok or not. The page''s freshness clock. Kept 7 days.';

-- ── trips ──────────────────────────────────────────────────────────────────
create table public.trips (
  id               uuid primary key default gen_random_uuid(),
  user_id          text not null default (auth.jwt() ->> 'sub'),   -- Clerk user id
  label            text not null check (char_length(btrim(label)) between 1 and 60),
  from_station_id  text not null references public.stations (station_id),
  to_station_id    text not null references public.stations (station_id),
  -- backups the person picked; empty = the page suggests the nearest ones
  from_backup_ids  text[] not null default '{}' check (cardinality(from_backup_ids) <= 3),
  to_backup_ids    text[] not null default '{}' check (cardinality(to_backup_ids) <= 3),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint trip_goes_somewhere check (from_station_id <> to_station_id)
);

create index trips_user on public.trips (user_id, created_at);
create unique index trips_user_label on public.trips (user_id, lower(btrim(label)));

comment on table public.trips is
  'Dockcheck: the trips each person follows. RLS: user_id = Clerk sub.';

-- ── Grants ─────────────────────────────────────────────────────────────────
-- Be explicit instead of relying on project defaults.
revoke all on public.stations, public.station_changes, public.worker_runs, public.trips
  from anon, authenticated;

grant select on public.stations, public.station_changes, public.worker_runs to authenticated;
grant select, insert, update, delete on public.trips to authenticated;

grant all on public.stations, public.station_changes, public.worker_runs, public.trips
  to service_role;

-- ── Row level security ─────────────────────────────────────────────────────
alter table public.stations        enable row level security;
alter table public.station_changes enable row level security;
alter table public.worker_runs     enable row level security;
alter table public.trips           enable row level security;

-- Shared live data: any signed-in person can read it. No write policies:
-- only service_role (which bypasses RLS) writes.
create policy "signed-in people read stations"
  on public.stations for select to authenticated using (true);

create policy "signed-in people read station changes"
  on public.station_changes for select to authenticated using (true);

create policy "signed-in people read worker runs"
  on public.worker_runs for select to authenticated using (true);

-- Trips: each person sees and edits only their own.
create policy "people read their own trips"
  on public.trips for select to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'));

create policy "people add their own trips"
  on public.trips for insert to authenticated
  with check (user_id = (select auth.jwt() ->> 'sub'));

create policy "people edit their own trips"
  on public.trips for update to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));

create policy "people delete their own trips"
  on public.trips for delete to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'));

-- Keep trips.updated_at honest.
create function public.dockcheck_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trips_touch_updated_at
  before update on public.trips
  for each row execute function public.dockcheck_touch_updated_at();

-- ── Realtime ───────────────────────────────────────────────────────────────
-- The other two of the three Realtime requirements (select granted, RLS policy)
-- are above. station_changes and trips are read on load, not streamed.
alter publication supabase_realtime add table public.stations, public.worker_runs;

-- ── Worker functions (service_role only) ───────────────────────────────────

-- Slow feed: insert new stations, update only rows whose info actually changed.
-- p_rows: [{station_id, name, lat, lon, capacity, station_type}, ...]
create function public.apply_station_information(p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_changed integer;
begin
  with incoming as (
    select *
    from jsonb_to_recordset(p_rows) as r(
      station_id text, name text, lat double precision, lon double precision,
      capacity integer, station_type text
    )
  ),
  upserted as (
    insert into public.stations as s (station_id, name, lat, lon, capacity, station_type)
    select station_id, name, lat, lon, capacity, station_type from incoming
    on conflict (station_id) do update
      set name = excluded.name,
          lat = excluded.lat,
          lon = excluded.lon,
          capacity = excluded.capacity,
          station_type = excluded.station_type,
          info_updated_at = now()
      where (s.name, s.lat, s.lon, s.capacity, s.station_type)
            is distinct from
            (excluded.name, excluded.lat, excluded.lon, excluded.capacity, excluded.station_type)
    returning 1
  )
  select count(*) into v_changed from upserted;

  return v_changed;
end;
$$;

-- Live feed: update only stations where a rider-facing field (or silent) changed,
-- and log count changes to station_changes. The diff happens here, in Postgres,
-- so the worker never reads 2,079 rows back (docs/03-data-flow.md decision 3).
-- p_rows: [{station_id, bikes, ebikes, docks, bikes_disabled, docks_disabled,
--           is_installed, is_renting, is_returning, reported_at}, ...]
-- Returns {"changed": n, "unknown": n}. "unknown" = ids not in stations yet,
-- which tells the worker to refresh station_information.
create function public.apply_station_status(p_rows jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_changed integer;
  v_unknown integer;
begin
  -- Two overlapping runs (10 s schedule, slow Divvy) must not interleave.
  perform pg_advisory_xact_lock(hashtext('dockcheck.apply_station_status'));

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
  logged as (
    insert into public.station_changes
      (station_id, bikes_before, bikes_after, ebikes_before, ebikes_after, docks_before, docks_after)
    select station_id, old_bikes, bikes, old_ebikes, ebikes, old_docks, docks
    from diff
    where counts_changed
      and old_bikes is not null   -- first sighting fills the row; it isn't a change
    returning 1
  )
  select (select count(*) from updated) into v_changed;

  select count(*) into v_unknown
  from jsonb_to_recordset(p_rows) as r(station_id text)
  where not exists (select 1 from public.stations s where s.station_id = r.station_id);

  return jsonb_build_object('changed', v_changed, 'unknown', v_unknown);
end;
$$;

-- Functions in public are reachable through the Data API: lock them to the worker.
revoke execute on function public.apply_station_information(jsonb) from public, anon, authenticated;
revoke execute on function public.apply_station_status(jsonb)      from public, anon, authenticated;
revoke execute on function public.dockcheck_touch_updated_at()     from public, anon, authenticated;
grant  execute on function public.apply_station_information(jsonb) to service_role;
grant  execute on function public.apply_station_status(jsonb)      to service_role;

-- ── Cleanup ────────────────────────────────────────────────────────────────
-- station_changes ≈ 35,000 rows/day, worker_runs = 8,640 rows/day. Keep the
-- database well inside the free 500 MB. (The worker's own 10 s schedule is added
-- in the worker step, once the Edge Function exists.)
select cron.schedule(
  'dockcheck-cleanup',
  '17 * * * *',   -- hourly, at :17
  $$
    delete from public.station_changes where changed_at < now() - interval '24 hours';
    delete from public.worker_runs     where ran_at     < now() - interval '7 days';
  $$
);
