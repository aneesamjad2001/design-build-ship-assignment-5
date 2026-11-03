-- Part 1 (run alone): fetch the Step 1 samples from the repo. Note the three ids.
select
  net.http_get('https://raw.githubusercontent.com/aneesamjad2001/design-build-ship-assignment-5/main/docs/source-samples/station_information.2026-11-02.json') as info_req,
  net.http_get('https://raw.githubusercontent.com/aneesamjad2001/design-build-ship-assignment-5/main/docs/source-samples/station_status.2026-11-02T2020.json') as a_req,
  net.http_get('https://raw.githubusercontent.com/aneesamjad2001/design-build-ship-assignment-5/main/docs/source-samples/station_status.2026-11-02T2027.json') as b_req;

-- Part 2 (run alone, a few seconds later): set the ids from part 1 below.
-- Expected: 22, 0, {22,0}, 0, {11,0}, 9, {0,0}, {1,0}, 9, {1,1}, then an
-- University Ave & 57th St row with bikes 2 -> 0, docks 45 -> 47.
-- Runs in one implicit transaction, so the final delete leaves no test rows.
create temp table ids on commit drop as select 1 as info_req, 2 as a_req, 3 as b_req;  -- ← edit

create temp table fx on commit drop as
with st as (
  select r.id, s
  from net._http_response r, jsonb_array_elements(r.content::jsonb -> 'data' -> 'stations') s
)
select
  (select jsonb_agg(jsonb_build_object(
      'station_id', s->>'station_id', 'name', s->>'name',
      'lat', (s->>'lat')::float8, 'lon', (s->>'lon')::float8,
      'capacity', (s->>'capacity')::int, 'station_type', s->>'station_type'))
   from st where id = (select info_req from ids)) as info,
  (select jsonb_agg(jsonb_build_object(
      'station_id', s->>'station_id',
      'bikes', (s->>'num_bikes_available')::int, 'ebikes', (s->>'num_ebikes_available')::int,
      'docks', (s->>'num_docks_available')::int,
      'bikes_disabled', (s->>'num_bikes_disabled')::int, 'docks_disabled', (s->>'num_docks_disabled')::int,
      'is_installed', (s->>'is_installed')::int = 1, 'is_renting', (s->>'is_renting')::int = 1,
      'is_returning', (s->>'is_returning')::int = 1,
      'reported_at', to_timestamp((s->>'last_reported')::bigint)))
   from st where id = (select a_req from ids)) as a,
  (select jsonb_agg(jsonb_build_object(
      'station_id', s->>'station_id',
      'bikes', (s->>'num_bikes_available')::int, 'ebikes', (s->>'num_ebikes_available')::int,
      'docks', (s->>'num_docks_available')::int,
      'bikes_disabled', (s->>'num_bikes_disabled')::int, 'docks_disabled', (s->>'num_docks_disabled')::int,
      'is_installed', (s->>'is_installed')::int = 1, 'is_renting', (s->>'is_renting')::int = 1,
      'is_returning', (s->>'is_returning')::int = 1,
      'reported_at', to_timestamp((s->>'last_reported')::bigint)))
   from st where id = (select b_req from ids)) as b;

create temp table t(step int, label text, result jsonb) on commit drop;
insert into t select 1, 'info: first load', to_jsonb(public.apply_station_information(info)) from fx;
insert into t select 2, 'info: same again', to_jsonb(public.apply_station_information(info)) from fx;
insert into t select 3, 'status 8:20 PM (first fill)', public.apply_station_status(a) from fx;
insert into t select 4, 'change log rows', to_jsonb((select count(*) from public.station_changes));
insert into t select 5, 'status 8:27 PM', public.apply_station_status(b) from fx;
insert into t select 6, 'change log rows', to_jsonb((select count(*) from public.station_changes));
insert into t select 7, 'status 8:27 PM again', public.apply_station_status(b) from fx;
insert into t select 8, 'one station reports now (silent -> live)',
  public.apply_station_status(jsonb_set(b, '{0,reported_at}', to_jsonb(now()))) from fx;
insert into t select 9, 'change log rows', to_jsonb((select count(*) from public.station_changes));
insert into t select 10, 'unknown station id',
  public.apply_station_status(b || jsonb_build_array(jsonb_set(b->0, '{station_id}', '"not-a-station"'))) from fx;
insert into t select 11, 'example change row',
  (select to_jsonb(c) - 'id' from public.station_changes c join public.stations s using (station_id)
    where s.name like 'University Ave & 57th%' limit 1);

delete from public.station_changes;
delete from public.stations;

select step, label, result from t order by step;
