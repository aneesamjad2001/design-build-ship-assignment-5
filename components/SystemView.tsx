"use client";

import { useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { ago } from "@/lib/freshness";
import { useSupabase } from "@/lib/useSupabase";
import { RUN_COLUMNS } from "@/lib/types";
import type { WorkerRun } from "@/lib/types";

type Run = WorkerRun & { rows_changed: number; duration_ms: number | null; id?: number };
type Stats = {
  since: string | null;
  runs: number;
  failed: number;
  applied: number;
  unchanged: number;
  rows_written: number;
  avg_ms: number | null;
  stations: number;
  reporting: number;
  changes_24h: number;
};

const STRIP = 60; // the last 10 minutes of runs
const n = (x: number) => x.toLocaleString("en-US");
const kind = (r: Run) => (!r.ok ? "failed" : r.feed_unchanged ? "unchanged" : "applied");

/** One part of the pipeline: what it is, its live state in words, and one number. */
function Node({ name, role, state, detail }: { name: string; role: string; state: string; detail: string }) {
  return (
    <li className="rounded-2xl border border-line bg-surface p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{role}</p>
      <p className="text-lg font-semibold">{name}</p>
      <p className="font-medium">{state}</p>
      <p className="text-sm text-muted">{detail}</p>
    </li>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <li aria-hidden className="flex items-center gap-2 py-1 pl-4 text-sm text-muted">
      <svg viewBox="0 0 12 16" className="h-4 w-3">
        <path d="M6 1v12M2 9l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {label}
    </li>
  );
}

export function SystemView() {
  const db = useSupabase();
  const [runs, setRuns] = useState<Run[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [live, setLive] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [newest, setNewest] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!db) return;
    let alive = true;
    let channel: RealtimeChannel | null = null;

    const loadStats = async () => {
      const r = await db.rpc("dockcheck_system_stats");
      if (!alive) return;
      if (r.error) setError(r.error.message);
      else setStats(r.data as Stats);
    };
    const loadRuns = async () => {
      const r = await db
        .from("worker_runs")
        .select(`id,${RUN_COLUMNS},rows_changed,duration_ms`)
        .order("ran_at", { ascending: false })
        .limit(STRIP);
      if (!alive) return;
      if (r.error) setError(r.error.message);
      else setRuns(((r.data ?? []) as Run[]).reverse());
    };

    void loadRuns();
    void loadStats();
    const statsTimer = setInterval(loadStats, 60_000);

    // Every run, as it happens: this page is the one place that listens to all of them
    // (about 6 a minute, only while it's open).
    channel = db
      .channel(`dockcheck-system:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "worker_runs" }, (p) => {
        const run = p.new as Run;
        setRuns((prev) => [...prev, run].slice(-STRIP));
        setNewest(run.ran_at);
        setStats((s) =>
          s
            ? {
                ...s,
                runs: s.runs + 1,
                failed: s.failed + (run.ok ? 0 : 1),
                applied: s.applied + (run.ok && !run.feed_unchanged ? 1 : 0),
                unchanged: s.unchanged + (run.feed_unchanged ? 1 : 0),
                rows_written: s.rows_written + (run.rows_changed ?? 0),
              }
            : s,
        );
      })
      .subscribe((status) => {
        if (!alive) return;
        if (status === "SUBSCRIBED") {
          setLive("live");
          void loadRuns();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setLive("reconnecting");
      });

    return () => {
      alive = false;
      clearInterval(statsTimer);
      if (channel) void db.removeChannel(channel);
    };
  }, [db]);

  const last = runs.at(-1);
  const lastFeed = [...runs].reverse().find((r) => r.ok && r.feed_updated_at)?.feed_updated_at ?? null;
  const recent = runs.slice(-STRIP);
  const counts = { applied: 0, unchanged: 0, failed: 0 };
  for (const r of recent) counts[kind(r)]++;
  const naive = stats ? stats.runs * stats.stations : 0;
  const saved = stats && naive ? Math.round((1 - stats.rows_written / naive) * 1000) / 10 : null;
  const hours = stats?.since && now ? Math.round((now - Date.parse(stats.since)) / 360_000) / 10 : null;

  return (
    <div className="space-y-6 py-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Under the hood</h1>
        <p className="text-muted">
          The live system behind your trips, running right now. Every number here updates by itself.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-no-bg px-3 py-2 font-medium text-no-text">
          Couldn&rsquo;t load the system numbers: {error}
        </p>
      )}

      <section aria-labelledby="pipeline">
        <h2 id="pipeline" className="mb-2 text-lg font-semibold">
          The pipeline
        </h2>
        <ol className="space-y-1">
          <Node
            role="Source"
            name="Divvy's live feed"
            state={lastFeed && now ? `Published ${ago(now - Date.parse(lastFeed))}` : "Waiting for the first run…"}
            detail={stats ? `${n(stats.stations)} stations, ${n(stats.reporting)} reporting right now` : "Open data (GBFS), no key"}
          />
          <Arrow label="read every 10 s" />
          <Node
            role="Worker"
            name="poll-divvy (Supabase Edge Function)"
            state={last && now ? `${last.ok ? "Ran" : "Failed"} ${ago(now - Date.parse(last.ran_at))}` : "…"}
            detail={stats?.avg_ms ? `Supabase Cron, every 10 s · ${n(stats.avg_ms)} ms on average` : "Supabase Cron, every 10 s"}
          />
          <Arrow label="saves only what changed" />
          <Node
            role="Database"
            name="Supabase Postgres"
            state={stats ? `${n(stats.rows_written)} station rows written` : "…"}
            detail={
              saved !== null
                ? `instead of ${n(naive)} if every run rewrote every station: ${saved}% never written`
                : "One row per run in worker_runs"
            }
          />
          <Arrow label="pushes each change" />
          <Node
            role="Realtime"
            name="Supabase Realtime"
            state={live === "live" ? "Connected to this page" : live === "connecting" ? "Connecting…" : "Reconnecting…"}
            detail="Your trips page hears only its own stations, and only runs that changed something"
          />
        </ol>
      </section>

      <section aria-labelledby="runs">
        <h2 id="runs" className="text-lg font-semibold">
          The last 10 minutes of runs
        </h2>
        <p className="text-sm text-muted">One mark per run, newest on the right. Divvy publishes about once a minute.</p>
        <div className="mt-2 rounded-2xl border border-line bg-surface p-3">
          <svg viewBox={`0 0 ${STRIP * 5} 40`} className="h-12 w-full" role="img" aria-label="Runs over the last 10 minutes">
            {recent.map((r, i) => {
              const k = kind(r);
              const x = (STRIP - recent.length + i) * 5;
              const isNew = r.ran_at === newest;
              // Three shapes, not just three colors: tall bar, short bar, and a cross.
              return k === "applied" ? (
                <rect key={r.ran_at} x={x + 0.5} y={4} width={4} height={36} rx={1} className={`fill-go-text ${isNew ? "pop" : ""}`} />
              ) : k === "unchanged" ? (
                <rect key={r.ran_at} x={x + 0.5} y={32} width={4} height={8} rx={1} className="fill-muted" />
              ) : (
                <path key={r.ran_at} d={`M${x + 0.5},14 l4,8 M${x + 4.5},14 l-4,8`} className="stroke-no-text" strokeWidth={1.5} />
              );
            })}
          </svg>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <li>
              <span aria-hidden className="mr-1 inline-block h-3.5 w-1.5 rounded-sm bg-go-text align-[-2px]" />
              Wrote changes: {counts.applied}
            </li>
            <li>
              <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 rounded-sm bg-muted" />
              Nothing new: {counts.unchanged}
            </li>
            <li>
              <span aria-hidden className="mr-1 font-bold text-no-text">✕</span>
              Failed: {counts.failed}
            </li>
          </ul>
        </div>
      </section>

      <section aria-labelledby="totals">
        <h2 id="totals" className="mb-2 text-lg font-semibold">
          {hours !== null ? `Since it started (${hours} h ago)` : "Since it started"}
        </h2>
        <dl className="grid grid-cols-2 gap-3">
          {[
            ["Runs", stats ? n(stats.runs) : "…"],
            ["Failed", stats ? n(stats.failed) : "…"],
            ["Found nothing new", stats && stats.runs ? `${Math.round((stats.unchanged / stats.runs) * 1000) / 10}%` : "…"],
            ["Changes logged (24 h)", stats ? n(stats.changes_24h) : "…"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-line bg-surface p-3">
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="text-2xl font-bold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
