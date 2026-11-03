// The run logic with fake Divvy and a fake database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INFO_URL, STATUS_URL } from "./divvy.ts";
import type { InfoRow, StatusRow } from "./divvy.ts";
import { INFO_RETRY_MS, runOnce, STALE_NOTE } from "./run.ts";
import type { Deps, RunRecord } from "./run.ts";

const samples = join(import.meta.dirname, "../../../docs/source-samples");
const load = (name: string) => JSON.parse(readFileSync(join(samples, name), "utf8"));
const status820 = load("station_status.2026-11-02T2020.json");
const status827 = load("station_status.2026-11-02T2027.json");
const info = load("station_information.2026-11-02.json");
const NOW = Date.parse("2026-11-03T02:28:00Z");

/** A tiny stand-in for the database that applies the same rules as apply_station_status:
 *  only real changes, refuse older feeds, mark stations that drop out as not reporting. */
function fakeWorld(feeds: Record<string, unknown | Error>) {
  const stations = new Map<string, Partial<StatusRow> & { name?: string; silent?: boolean }>();
  const runs: RunRecord[] = [];
  const calls = { fetch: [] as string[], applyStatus: 0, applyInformation: 0 };
  let lastInfoRefreshAt: string | null = null;
  let watermark: string | null = null;
  const riderFields = ["bikes", "ebikes", "docks", "bikes_disabled", "docks_disabled", "is_installed", "is_renting", "is_returning"] as const;

  const deps: Deps = {
    fetchJson: async (url) => {
      calls.fetch.push(url);
      const f = feeds[url];
      if (f instanceof Error) throw f;
      return f;
    },
    lastAppliedFeedAt: async () => [...runs].reverse().find((r) => r.ok)?.feed_updated_at ?? null,
    lastInfoRefreshAt: async () => lastInfoRefreshAt,
    applyStatus: async (rows, feedAt) => {
      calls.applyStatus++;
      if (watermark !== null && Date.parse(feedAt) < Date.parse(watermark)) {
        return { changed: 0, unknown: 0, missing: 0, stale: true };
      }
      let changed = 0, unknown = 0, missing = 0;
      const seen = new Set(rows.map((r) => r.station_id));
      for (const r of rows) {
        const s = stations.get(r.station_id);
        if (!s) { unknown++; continue; }
        if (riderFields.some((k) => s[k] !== r[k]) || s.silent) { Object.assign(s, r, { silent: false }); changed++; }
      }
      for (const [stationId, s] of stations) {
        if (!seen.has(stationId) && s.bikes !== undefined && !s.silent) { s.silent = true; missing++; }
      }
      watermark = watermark && Date.parse(watermark) > Date.parse(feedAt) ? watermark : feedAt;
      return { changed: changed + missing, unknown, missing, stale: false };
    },
    applyInformation: async (rows: InfoRow[]) => {
      calls.applyInformation++;
      let changed = 0;
      for (const r of rows) {
        const s = stations.get(r.station_id);
        if (!s) { stations.set(r.station_id, { name: r.name }); changed++; }
        else if (s.name !== r.name) { s.name = r.name; changed++; }
      }
      lastInfoRefreshAt = new Date(NOW).toISOString();
      return changed;
    },
    recordRun: async (run) => { runs.push(run); },
    now: () => NOW,
  };
  return { deps, runs, calls, stations, setFeed: (url: string, v: unknown) => { feeds[url] = v; }, setLastInfoRefresh: (t: string | null) => { lastInfoRefreshAt = t; } };
}

test("first run on an empty table: learns station info, then saves every station", async () => {
  const w = fakeWorld({ [STATUS_URL]: status820, [INFO_URL]: info });
  const run = await runOnce(w.deps);
  assert.equal(run.ok, true);
  assert.equal(run.info_changed, 22);
  assert.equal(run.rows_changed, 22);
  assert.equal(run.stations_seen, 22);
  assert.equal(run.error, null);
  assert.equal(w.calls.applyStatus, 2); // once (all unknown), again after the info refresh
  assert.equal(w.runs.length, 1);
});

test("8:20 then 8:27: only the 11 stations whose rider fields changed are saved", async () => {
  const w = fakeWorld({ [STATUS_URL]: status820, [INFO_URL]: info });
  await runOnce(w.deps);
  w.setFeed(STATUS_URL, status827);
  const run = await runOnce(w.deps);
  assert.equal(run.ok, true);
  assert.equal(run.rows_changed, 11);
  assert.equal(run.info_changed, null); // no unknown stations: info not refetched
  assert.equal(run.feed_unchanged, false);
});

test("same feed file again (Divvy publishes every ~60 s): recorded, nothing applied", async () => {
  const w = fakeWorld({ [STATUS_URL]: status827, [INFO_URL]: info });
  await runOnce(w.deps);
  const before = w.calls.applyStatus;
  const run = await runOnce(w.deps);
  assert.equal(run.ok, true);
  assert.equal(run.feed_unchanged, true);
  assert.equal(run.rows_changed, 0);
  assert.equal(w.calls.applyStatus, before);
  assert.equal(w.runs.length, 2); // still one row per run
});

test("Divvy down: a failed run is recorded with the reason, nothing written", async () => {
  const w = fakeWorld({ [STATUS_URL]: new Error("Divvy didn't answer within 8 s") });
  const run = await runOnce(w.deps);
  assert.equal(run.ok, false);
  assert.equal(run.error, "Divvy didn't answer within 8 s");
  assert.equal(run.feed_updated_at, null);
  assert.equal(w.calls.applyStatus, 0);
  assert.equal(w.runs.length, 1);
});

test("format changed (most rows invalid): fails loudly instead of saving zeros", async () => {
  const renamed = {
    ...status827,
    data: { stations: status827.data.stations.map((s: Record<string, unknown>) => ({ ...s, num_bikes_available: undefined, vehicle_types_available: [] })) },
  };
  const w = fakeWorld({ [STATUS_URL]: renamed, [INFO_URL]: info });
  const run = await runOnce(w.deps);
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /22 of 22 stations failed validation/);
  assert.equal(run.rows_rejected, 22);
  assert.equal(w.calls.applyStatus, 0);
});

test("one odd station: skipped and counted, the run still succeeds", async () => {
  const oneBad = {
    ...status827,
    data: { stations: status827.data.stations.map((s: Record<string, unknown>, i: number) => (i === 0 ? { ...s, num_docks_available: -3 } : s)) },
  };
  const w = fakeWorld({ [STATUS_URL]: oneBad, [INFO_URL]: info });
  const run = await runOnce(w.deps);
  assert.equal(run.ok, true);
  assert.equal(run.rows_rejected, 1);
  assert.equal(run.rows_changed, 21);
});

test("unknown station but info was refreshed recently: no refetch, run notes it", async () => {
  const w = fakeWorld({ [STATUS_URL]: status827, [INFO_URL]: info });
  w.setLastInfoRefresh(new Date(NOW - INFO_RETRY_MS / 3).toISOString());
  const run = await runOnce(w.deps);
  assert.equal(run.ok, true);
  assert.equal(run.info_changed, null);
  assert.equal(w.calls.applyInformation, 0);
  assert.match(run.error ?? "", /22 stations .* missing from station info/);
});

test("hourly refresh_info: fetches station info even when the feed is unchanged", async () => {
  const w = fakeWorld({ [STATUS_URL]: status827, [INFO_URL]: info });
  await runOnce(w.deps);
  const run = await runOnce(w.deps, { refreshInfo: true });
  assert.equal(run.ok, true);
  assert.equal(run.info_changed, 0); // nothing renamed
  assert.equal(run.feed_unchanged, false);
});

test("overlapping run with an OLDER feed: refused, counts not rolled back", async () => {
  const w = fakeWorld({ [STATUS_URL]: status820, [INFO_URL]: info });
  await runOnce(w.deps); // applies 8:20
  w.setFeed(STATUS_URL, status827);
  await runOnce(w.deps); // applies 8:27
  // A slow run that fetched 8:20 finishes now. lastAppliedFeedAt isn't consulted for it
  // (it fetched before 8:27 landed), so force the apply path with refresh_info.
  w.setFeed(STATUS_URL, status820);
  const run = await runOnce(w.deps, { refreshInfo: true });
  assert.equal(run.ok, true);
  assert.equal(run.error, STALE_NOTE);
  assert.equal(run.rows_changed, 0);
  const uni57 = w.stations.get("a3ad8072-a135-11e9-9cda-0a87ae2ba916");
  assert.equal(uni57?.bikes, 0); // still the 8:27 value, not 8:20's 2
});

test("a station that drops out of a healthy feed is marked not reporting", async () => {
  const w = fakeWorld({ [STATUS_URL]: status827, [INFO_URL]: info });
  await runOnce(w.deps);
  const dropped = status827.data.stations[0].station_id;
  w.setFeed(STATUS_URL, {
    ...status827,
    last_updated: status827.last_updated + 60,
    data: { stations: status827.data.stations.slice(1) },
  });
  const run = await runOnce(w.deps);
  assert.equal(run.ok, true);
  assert.equal(w.stations.get(dropped)?.silent, true);
  assert.match(run.error ?? "", /1 stations dropped out of the feed/);
});

test("recording the run fails: the error surfaces once, no second 'failed' run is invented", async () => {
  const w = fakeWorld({ [STATUS_URL]: status827, [INFO_URL]: info });
  let attempts = 0;
  w.deps.recordRun = async () => { attempts++; throw new Error("Database worker_runs: HTTP 503"); };
  await assert.rejects(runOnce(w.deps), /HTTP 503/);
  assert.equal(attempts, 1);
});

test("database error mid-run: recorded as a failed run with the reason", async () => {
  const w = fakeWorld({ [STATUS_URL]: status827, [INFO_URL]: info });
  w.deps.applyStatus = async () => { throw new Error("Database rpc/apply_station_status: HTTP 503"); };
  const run = await runOnce(w.deps);
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /HTTP 503/);
});
