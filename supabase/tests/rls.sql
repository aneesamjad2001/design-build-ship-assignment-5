-- Who can read and write what. Two pretend Clerk users (A, B) and a signed-out visitor.
-- Runs in one implicit transaction; the final deletes leave no test rows.
-- Safe to run with the worker live: it only touches its own test-* stations and user_test_* trips.

-- Two stations for the trips to point at
insert into public.stations (station_id, name, lat, lon, capacity, station_type) values
  ('test-57th', 'University Ave & 57th St', 41.791478, -87.599861, 48, 'classic'),
  ('test-58th', 'Ellis Ave & 58th St',      41.788746, -87.601334, 19, 'classic');

create temp table r(step int, test text, expected text, got text) on commit drop;
grant all on r to authenticated, anon;

-- Person A
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_test_a","role":"authenticated"}';
insert into public.trips (label, from_station_id, to_station_id) values ('Home → the Reg', 'test-57th', 'test-58th');
insert into r select 1, 'A adds a trip; user_id filled from token', 'user_test_a',
  (select user_id from public.trips where label = 'Home → the Reg');
do $$ begin
  insert into public.trips (user_id, label, from_station_id, to_station_id) values ('user_test_b', 'Sneaky', 'test-57th', 'test-58th');
  insert into r values (2, 'A adds a trip as B', 'blocked', 'ALLOWED');
exception when others then insert into r values (2, 'A adds a trip as B', 'blocked', 'blocked: ' || sqlerrm); end $$;
do $$ begin
  insert into public.trips (label, from_station_id, to_station_id) values ('  home → THE reg ', 'test-57th', 'test-58th');
  insert into r values (3, 'A reuses a label (case/space differ)', 'blocked', 'ALLOWED');
exception when others then insert into r values (3, 'A reuses a label (case/space differ)', 'blocked', 'blocked: ' || sqlerrm); end $$;
do $$ begin
  insert into public.trips (label, from_station_id, to_station_id) values ('Nowhere', 'test-57th', 'test-57th');
  insert into r values (4, 'A adds a trip from X to X', 'blocked', 'ALLOWED');
exception when others then insert into r values (4, 'A adds a trip from X to X', 'blocked', 'blocked: ' || sqlerrm); end $$;

-- Person B
set local request.jwt.claims = '{"sub":"user_test_b","role":"authenticated"}';
insert into r select 5, 'B sees A''s trips', '0', (select count(*)::text from public.trips);
with u as (update public.trips set label = 'hijacked' returning 1)
  insert into r select 6, 'B edits A''s trip', '0 rows', (select count(*) || ' rows' from u);
with d as (delete from public.trips returning 1)
  insert into r select 7, 'B deletes A''s trip', '0 rows', (select count(*) || ' rows' from d);
insert into r select 8, 'B reads stations', '2', (select count(*)::text from public.stations where station_id like 'test-%');
insert into r select 9, 'B reads worker_runs', 'allowed', (select 'allowed: ' || count(*) from public.worker_runs);
do $$ begin
  update public.stations set bikes = 99 where station_id like 'test-%';
  insert into r values (10, 'B writes stations', 'blocked', 'ALLOWED');
exception when others then insert into r values (10, 'B writes stations', 'blocked', 'blocked: ' || sqlerrm); end $$;
do $$ begin
  perform public.apply_station_status('[]'::jsonb, now());
  insert into r values (11, 'B calls the worker function', 'blocked', 'ALLOWED');
exception when others then insert into r values (11, 'B calls the worker function', 'blocked', 'blocked: ' || sqlerrm); end $$;
do $$ begin
  insert into public.worker_runs (ok) values (true);
  insert into r values (12, 'B fakes a worker run', 'blocked', 'ALLOWED');
exception when others then insert into r values (12, 'B fakes a worker run', 'blocked', 'blocked: ' || sqlerrm); end $$;
do $$ begin
  perform public.dockcheck_worker_secret();
  insert into r values (16, 'B reads the worker secret', 'blocked', 'ALLOWED');
exception when others then insert into r values (16, 'B reads the worker secret', 'blocked', 'blocked: ' || sqlerrm); end $$;
do $$ begin
  perform count(*) from public.feed_state;
  insert into r values (17, 'B reads feed_state', 'blocked', 'ALLOWED');
exception when others then insert into r values (17, 'B reads feed_state', 'blocked', 'blocked: ' || sqlerrm); end $$;

-- Signed out
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  perform count(*) from public.stations;
  insert into r values (13, 'signed-out reads stations', 'blocked', 'ALLOWED');
exception when others then insert into r values (13, 'signed-out reads stations', 'blocked', 'blocked: ' || sqlerrm); end $$;
do $$ begin
  perform count(*) from public.trips;
  insert into r values (14, 'signed-out reads trips', 'blocked', 'ALLOWED');
exception when others then insert into r values (14, 'signed-out reads trips', 'blocked', 'blocked: ' || sqlerrm); end $$;

-- Back to A
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_test_a","role":"authenticated"}';
insert into r select 15, 'A still has the trip, label unchanged', '1 · Home → the Reg',
  (select count(*) || ' · ' || min(label) from public.trips);

reset role;
delete from public.trips where user_id like 'user_test_%';
delete from public.stations where station_id like 'test-%';
select step, test, expected, got from r order by step;
