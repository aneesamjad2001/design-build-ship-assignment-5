// One worker run, with every outside effect passed in. index.ts wires the real ones
// (Divvy over HTTP, Postgres through the Data API); run.test.ts passes fakes.

import { FeedError, INFO_URL, parseInformation, parseStatus, STATUS_URL } from "./divvy.ts";
import type { InfoRow, StatusRow } from "./divvy.ts";

/** One row of public.worker_runs (ran_at is set by the database). */
export type RunRecord = {
  ok: boolean;
  rows_changed: number;
  rows_rejected: number;
  stations_seen: number | null;
  feed_updated_at: string | null;
  feed_unchanged: boolean;
  info_changed: number | null; // null = station info not refreshed this run
  duration_ms: number;
  error: string | null;
};

export type Deps = {
  fetchJson(url: string): Promise<unknown>;
  /** feed_updated_at of the latest ok run that actually applied a feed, or null. */
  lastAppliedFeedAt(): Promise<string | null>;
  /** ran_at of the latest run that refreshed station info, or null. */
  lastInfoRefreshAt(): Promise<string | null>;
  applyStatus(rows: StatusRow[]): Promise<{ changed: number; unknown: number }>;
  applyInformation(rows: InfoRow[]): Promise<number>;
  recordRun(run: RunRecord): Promise<void>;
  now(): number;
};

export type Options = { refreshInfo?: boolean };

/** More than this share of bad rows means the format changed: fail loudly instead of half-saving. */
export const MAX_REJECTED_SHARE = 0.1;
/** Unknown station ids trigger an info refresh, but not more often than this. */
export const INFO_RETRY_MS = 15 * 60 * 1000;

export async function runOnce(deps: Deps, opts: Options = {}): Promise<RunRecord> {
  const started = deps.now();
  let feedUpdatedAt: string | null = null;
  let stationsSeen: number | null = null;
  let rejected = 0;
  let infoChanged: number | null = null;
  let changed = 0; // rows already written, so a run that fails partway still reports them

  const refreshInfo = async () => {
    const info = parseInformation(await deps.fetchJson(INFO_URL));
    if (info.rows.length === 0 || info.rejected > info.total * MAX_REJECTED_SHARE) {
      throw new FeedError(`Station info: ${info.rejected} of ${info.total} rows failed validation`);
    }
    infoChanged = (infoChanged ?? 0) + (await deps.applyInformation(info.rows));
  };

  const finish = async (run: Omit<RunRecord, "duration_ms">): Promise<RunRecord> => {
    const record = { ...run, duration_ms: Math.max(0, Math.round(deps.now() - started)) };
    await deps.recordRun(record);
    return record;
  };

  try {
    const status = parseStatus(await deps.fetchJson(STATUS_URL), started);
    feedUpdatedAt = status.feedUpdatedAt;
    stationsSeen = status.total;
    rejected = status.rejected;

    if (status.rows.length === 0 || status.rejected > status.total * MAX_REJECTED_SHARE) {
      throw new FeedError(`${status.rejected} of ${status.total} stations failed validation`);
    }

    if (opts.refreshInfo) {
      await refreshInfo();
    } else {
      // Divvy republishes about every 60 s; we run every 10 s. Same file = nothing to do.
      const last = await deps.lastAppliedFeedAt();
      if (last !== null && Date.parse(last) === Date.parse(status.feedUpdatedAt)) {
        return await finish({
          ok: true,
          rows_changed: 0,
          rows_rejected: rejected,
          stations_seen: stationsSeen,
          feed_updated_at: feedUpdatedAt,
          feed_unchanged: true,
          info_changed: null,
          error: null,
        });
      }
    }

    let result = await deps.applyStatus(status.rows);
    changed = result.changed;
    let note: string | null = null;

    if (result.unknown > 0 && infoChanged === null) {
      // New stations (or a first run on an empty table): learn their names, then retry.
      const lastRefresh = await deps.lastInfoRefreshAt();
      if (lastRefresh === null || started - Date.parse(lastRefresh) > INFO_RETRY_MS) {
        await refreshInfo();
        result = await deps.applyStatus(status.rows);
        changed += result.changed;
      }
    }
    if (result.unknown > 0) {
      note = `${result.unknown} stations in status are missing from station info; skipped`;
    }

    return await finish({
      ok: true,
      rows_changed: changed,
      rows_rejected: rejected,
      stations_seen: stationsSeen,
      feed_updated_at: feedUpdatedAt,
      feed_unchanged: false,
      info_changed: infoChanged,
      error: note,
    });
  } catch (e) {
    return await finish({
      ok: false,
      rows_changed: changed,
      rows_rejected: rejected,
      stations_seen: stationsSeen,
      feed_updated_at: feedUpdatedAt,
      feed_unchanged: false,
      info_changed: infoChanged,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
