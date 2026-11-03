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
  error: string | null; // why it failed, or a note on an ok run
};

export type ApplyResult = { changed: number; unknown: number; missing: number; stale: boolean };

export type Deps = {
  fetchJson(url: string): Promise<unknown>;
  /** feed_updated_at of the latest ok run, or null. */
  lastAppliedFeedAt(): Promise<string | null>;
  /** ran_at of the latest run that refreshed station info, or null. */
  lastInfoRefreshAt(): Promise<string | null>;
  /** public.apply_station_status: writes only real changes; refuses feeds older than one already applied. */
  applyStatus(rows: StatusRow[], feedUpdatedAt: string): Promise<ApplyResult>;
  applyInformation(rows: InfoRow[]): Promise<number>;
  recordRun(run: RunRecord): Promise<void>;
  now(): number;
};

export type Options = { refreshInfo?: boolean };

/** More than this share of bad rows means the format changed: fail loudly instead of half-saving. */
export const MAX_REJECTED_SHARE = 0.1;
/** Unknown station ids trigger an info refresh, but not more often than this. */
export const INFO_RETRY_MS = 15 * 60 * 1000;

export const STALE_NOTE = "A newer Divvy feed was already applied by an overlapping run; nothing written";

/**
 * Does the work, then records exactly one run. If recording itself fails, that error
 * propagates (the caller logs it); it is never re-recorded as a second, failed run.
 */
export async function runOnce(deps: Deps, opts: Options = {}): Promise<RunRecord> {
  const started = deps.now();
  const run = await work(deps, opts, started);
  const record: RunRecord = { ...run, duration_ms: Math.max(0, Math.round(deps.now() - started)) };
  await deps.recordRun(record);
  return record;
}

async function work(deps: Deps, opts: Options, started: number): Promise<Omit<RunRecord, "duration_ms">> {
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

  const result = (ok: boolean, extra: { feed_unchanged?: boolean; error?: string | null } = {}) => ({
    ok,
    rows_changed: changed,
    rows_rejected: rejected,
    stations_seen: stationsSeen,
    feed_updated_at: feedUpdatedAt,
    feed_unchanged: extra.feed_unchanged ?? false,
    info_changed: infoChanged,
    error: extra.error ?? null,
  });

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
        return result(true, { feed_unchanged: true });
      }
    }

    let applied = await deps.applyStatus(status.rows, status.feedUpdatedAt);
    if (applied.stale) return result(true, { feed_unchanged: true, error: STALE_NOTE });
    changed = applied.changed;

    if (applied.unknown > 0 && infoChanged === null) {
      // New stations (or a first run on an empty table): learn their names, then retry.
      const lastRefresh = await deps.lastInfoRefreshAt();
      if (lastRefresh === null || started - Date.parse(lastRefresh) > INFO_RETRY_MS) {
        await refreshInfo();
        applied = await deps.applyStatus(status.rows, status.feedUpdatedAt);
        if (applied.stale) return result(true, { error: STALE_NOTE });
        changed += applied.changed;
      }
    }

    const notes: string[] = [];
    if (applied.unknown > 0) notes.push(`${applied.unknown} stations in status are missing from station info; skipped`);
    if (applied.missing > 0) notes.push(`${applied.missing} stations dropped out of the feed; marked not reporting`);
    return result(true, { error: notes.length ? notes.join(". ") : null });
  } catch (e) {
    return result(false, { error: e instanceof Error ? e.message : String(e) });
  }
}
