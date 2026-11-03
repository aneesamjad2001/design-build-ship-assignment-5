-- Backups for the page: the nearest dock stations to each given station, with live counts.
-- Lets the page fetch a handful of rows instead of all 2,079 stations (egress), and keeps
-- the Realtime filter small (it accepts up to 100 station ids).
-- Security invoker: runs with the caller's rights, so the stations RLS policy applies.
create function public.dockcheck_nearby(
  p_station_ids text[],
  p_radius_m integer default 1200,
  p_per_origin integer default 3
)
returns table (
  origin_id text,
  station_id text,
  name text,
  lat double precision,
  lon double precision,
  capacity integer,
  station_type text,
  bikes integer,
  ebikes integer,
  docks integer,
  is_installed boolean,
  is_renting boolean,
  is_returning boolean,
  silent boolean,
  reported_at timestamptz,
  status_changed_at timestamptz,
  distance_m integer
)
language sql
stable
set search_path = ''
as $$
  select o.station_id as origin_id,
         n.station_id, n.name, n.lat, n.lon, n.capacity, n.station_type,
         n.bikes, n.ebikes, n.docks, n.is_installed, n.is_renting, n.is_returning,
         n.silent, n.reported_at, n.status_changed_at,
         n.distance_m
  from public.stations o
  cross join lateral (
    select s.*,
           round(2 * 6371000 * asin(sqrt(
             power(sin(radians(s.lat - o.lat) / 2), 2) +
             cos(radians(o.lat)) * cos(radians(s.lat)) * power(sin(radians(s.lon - o.lon) / 2), 2)
           )))::integer as distance_m
    from public.stations s
    where s.station_id <> o.station_id
      and s.station_type = 'classic'                  -- docks you can return to
      and not s.silent
      and abs(s.lat - o.lat) < p_radius_m / 111000.0  -- cheap box before the exact distance
    order by distance_m
    limit least(greatest(p_per_origin, 1), 10)
  ) n
  where o.station_id = any (p_station_ids[1:20])      -- at most 20 origins per call
    and n.distance_m <= p_radius_m
  order by o.station_id, n.distance_m;
$$;

revoke execute on function public.dockcheck_nearby(text[], integer, integer) from public, anon;
grant  execute on function public.dockcheck_nearby(text[], integer, integer) to authenticated, service_role;
