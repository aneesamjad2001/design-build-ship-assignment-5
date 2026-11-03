-- Fixes from the Supabase advisors after dockcheck_init.

-- 1. Security: pg_net was registered in public. It isn't relocatable, so recreate
--    it in the extensions schema. Nothing uses it yet (the worker schedule comes later).
drop extension if exists pg_net;
create extension pg_net with schema extensions;

-- 2. Performance: evaluate the Clerk user id once per query, not once per row.
alter policy "people read their own trips" on public.trips
  using (user_id = ((select auth.jwt()) ->> 'sub'));

alter policy "people add their own trips" on public.trips
  with check (user_id = ((select auth.jwt()) ->> 'sub'));

alter policy "people edit their own trips" on public.trips
  using (user_id = ((select auth.jwt()) ->> 'sub'))
  with check (user_id = ((select auth.jwt()) ->> 'sub'));

alter policy "people delete their own trips" on public.trips
  using (user_id = ((select auth.jwt()) ->> 'sub'));

-- 3. Performance: index trips' station foreign keys.
create index trips_from_station on public.trips (from_station_id);
create index trips_to_station   on public.trips (to_station_id);
