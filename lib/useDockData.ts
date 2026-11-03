"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { freshness } from "./freshness";
import type { Connection, Freshness } from "./freshness";
import { RUN_COLUMNS, STATION_COLUMNS } from "./types";
import type { Nearby, Station, Trip, WorkerRun } from "./types";

/** Realtime's `in` filter takes at most 100 values. */
const MAX_LIVE_IDS = 100;
/** Backups looked up per trip end. 8 trips × 2 ends × 4 = 64, plus the ends: under 100. */
export const NEARBY_PER_END = 4;
export const MAX_TRIPS = 8;
/** How long a changed number stays highlighted. */
export const FLASH_MS = 2500;

type NearbyRef = { origin_id: string; station_id: string; distance_m: number };
export type Flash = { at: number; bikes: boolean; docks: boolean };

export type DockData = {
  freshness: Freshness;
  connection: Connection;
  loadError: string | null;
  trips: Trip[];
  stations: Map<string, Station>;
  nearby: Nearby[];
  flashes: Map<string, Flash>;
  now: number;
  reload: () => void;
};

const unique = (xs: string[]) => [...new Set(xs)];

function pickStation(row: Record<string, unknown>): Station {
  const s = {} as Record<string, unknown>;
  for (const k of STATION_COLUMNS.split(",")) s[k] = row[k];
  return s as Station;
}

export function useDockData(supabase: SupabaseClient | null): DockData {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [stations, setStations] = useState<Map<string, Station>>(new Map());
  const [nearbyRefs, setNearbyRefs] = useState<NearbyRef[]>([]);
  const [latest, setLatest] = useState<WorkerRun | null>(null);
  const [lastOkFeedAt, setLastOkFeedAt] = useState<string | null>(null);
  const [probe, setProbe] = useState<WorkerRun | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [flashes, setFlashes] = useState<Map<string, Flash>>(new Map());
  const [now, setNow] = useState(0);
  const [reloads, setReloads] = useState(0);
  const stationsRef = useRef(stations);

  useEffect(() => {
    stationsRef.current = stations;
  }, [stations]);

  // The page's own clock: it is what turns "fresh" into "stale" when nothing arrives.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  /** Full read. Returns the station ids to listen to. `isCurrent` drops a read that
   *  finishes after its connection was replaced, so it can't overwrite newer numbers. */
  const load = useCallback(async (db: SupabaseClient, isCurrent: () => boolean = () => true): Promise<string[]> => {
    const tripsRes = await db
      .from("trips")
      .select("id,label,from_station_id,to_station_id,from_backup_ids,to_backup_ids,created_at")
      .order("created_at");
    if (tripsRes.error) throw new Error(tripsRes.error.message);
    const ts = (tripsRes.data ?? []) as Trip[];

    const ends = unique(ts.flatMap((t) => [t.from_station_id, t.to_station_id]));
    const pinned = unique(ts.flatMap((t) => [...t.from_backup_ids, ...t.to_backup_ids]));

    const [st, nb, last, lastOk] = await Promise.all([
      ends.length
        ? db.from("stations").select(STATION_COLUMNS).in("station_id", unique([...ends, ...pinned]))
        : Promise.resolve({ data: [], error: null }),
      ends.length
        ? db.rpc("dockcheck_nearby", { p_station_ids: ends, p_radius_m: 1200, p_per_origin: NEARBY_PER_END })
        : Promise.resolve({ data: [], error: null }),
      db.from("worker_runs").select(RUN_COLUMNS).order("ran_at", { ascending: false }).limit(1).maybeSingle(),
      db
        .from("worker_runs")
        .select("feed_updated_at")
        .eq("ok", true)
        .not("feed_updated_at", "is", null)
        .order("ran_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    for (const r of [st, nb, last, lastOk]) if (r.error) throw new Error(r.error.message);
    if (!isCurrent()) return [];

    const map = new Map<string, Station>();
    for (const row of (st.data ?? []) as Record<string, unknown>[]) map.set(row.station_id as string, pickStation(row));
    const refs: NearbyRef[] = [];
    for (const row of (nb.data ?? []) as Record<string, unknown>[]) {
      const s = pickStation(row);
      if (!map.has(s.station_id)) map.set(s.station_id, s);
      refs.push({ origin_id: row.origin_id as string, station_id: s.station_id, distance_m: row.distance_m as number });
    }

    setTrips(ts);
    setStations(map);
    setNearbyRefs(refs);
    setLatest((last.data as WorkerRun | null) ?? null);
    setLastOkFeedAt((lastOk.data as { feed_updated_at: string } | null)?.feed_updated_at ?? null);
    setProbe(null);
    setLoadError(null);
    setLoaded(true);

    // Trip ends first, then the person's backups, then suggested backups.
    return unique([...ends, ...pinned, ...refs.map((r) => r.station_id)]).slice(0, MAX_LIVE_IDS);
  }, []);

  const onStation = useCallback((row: Record<string, unknown>) => {
    const next = pickStation(row);
    const old = stationsRef.current.get(next.station_id);
    if (!old) return;
    const bikes = old.bikes !== next.bikes;
    const docks = old.docks !== next.docks;
    setStations((prev) => new Map(prev).set(next.station_id, next));
    if (bikes || docks) {
      setFlashes((prev) => new Map(prev).set(next.station_id, { at: Date.now(), bikes, docks }));
    }
  }, []);

  const onRun = useCallback((run: WorkerRun) => {
    setLatest(run);
    setProbe(null);
    if (run.ok && run.feed_updated_at) {
      setLastOkFeedAt((prev) => (prev && Date.parse(prev) > Date.parse(run.feed_updated_at!) ? prev : run.feed_updated_at));
    }
  }, []);

  // Load, then listen. Paused while the tab is hidden (Realtime's free quota), re-read on
  // every reconnect so a dropped socket can't leave the page silently behind.
  useEffect(() => {
    if (!supabase) return;
    let session = { alive: false, channel: null as RealtimeChannel | null };
    let retry: ReturnType<typeof setTimeout> | undefined;

    const start = async () => {
      const mine = { alive: true, channel: null as RealtimeChannel | null };
      session = mine;
      setConnection("connecting");
      let ids: string[];
      try {
        ids = await load(supabase, () => mine.alive);
      } catch (e) {
        if (!mine.alive) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        setLoaded(true);
        setConnection("reconnecting");
        // Flaky phone data: try again in 5 s rather than saying "Reconnecting…" forever.
        retry = setTimeout(() => {
          if (mine.alive) void start();
        }, 5000);
        return;
      }
      if (!mine.alive) return;

      let joinedBefore = false;
      const channel = supabase.channel(`dockcheck:${crypto.randomUUID()}`);
      if (ids.length) {
        channel.on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "stations", filter: `station_id=in.(${ids.join(",")})` },
          (p) => onStation(p.new as Record<string, unknown>),
        );
      }
      channel.on(
        "postgres_changes",
        // Only runs that changed something or failed: 1 in 6, which keeps Realtime in budget.
        { event: "INSERT", schema: "public", table: "worker_runs", filter: "feed_unchanged=eq.false" },
        (p) => onRun(p.new as WorkerRun),
      );
      channel.subscribe((status) => {
        if (!mine.alive) return;
        if (status === "SUBSCRIBED") {
          setConnection("live");
          if (joinedBefore) void load(supabase, () => mine.alive).catch(() => {});
          joinedBefore = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnection("reconnecting");
        }
      });
      mine.channel = channel;
    };

    const stop = () => {
      clearTimeout(retry);
      session.alive = false;
      if (session.channel) void supabase.removeChannel(session.channel);
      session.channel = null;
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
        setConnection("paused");
      } else {
        stop();
        void start();
      }
    };

    // Opened in a background tab: wait until it's visible (onVisibility starts it).
    if (!document.hidden) void start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [supabase, load, onStation, onRun, reloads]);

  const f = useMemo(
    () => freshness({ loaded, latest, lastOkFeedAt, probe, connection, now }),
    [loaded, latest, lastOkFeedAt, probe, connection, now],
  );

  // When stale, look up the very latest run (any kind) once a minute, to say why.
  // If it carries a NEWER Divvy feed than we have, Divvy and our checker are fine and we
  // missed Realtime messages: re-read and re-subscribe instead of blaming anyone.
  const isStale = f.state === "stale";
  const lastOkRef = useRef(lastOkFeedAt);
  useEffect(() => {
    lastOkRef.current = lastOkFeedAt;
  }, [lastOkFeedAt]);
  useEffect(() => {
    if (!supabase || !isStale) return;
    let cancelled = false;
    const look = async () => {
      const r = await supabase.from("worker_runs").select(RUN_COLUMNS).order("ran_at", { ascending: false }).limit(1).maybeSingle();
      if (cancelled || r.error) return;
      const run = (r.data as WorkerRun | null) ?? null;
      const ours = lastOkRef.current;
      if (run?.ok && run.feed_updated_at && (!ours || Date.parse(run.feed_updated_at) > Date.parse(ours))) {
        setReloads((n) => n + 1);
        return;
      }
      setProbe(run);
    };
    void look();
    const id = setInterval(look, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [supabase, isStale]);

  const nearby = useMemo<Nearby[]>(
    () =>
      nearbyRefs.flatMap((r) => {
        const s = stations.get(r.station_id);
        return s ? [{ ...s, origin_id: r.origin_id, distance_m: r.distance_m }] : [];
      }),
    [nearbyRefs, stations],
  );

  return {
    freshness: f,
    connection,
    loadError,
    trips,
    stations,
    nearby,
    flashes,
    now,
    reload: () => setReloads((n) => n + 1),
  };
}
