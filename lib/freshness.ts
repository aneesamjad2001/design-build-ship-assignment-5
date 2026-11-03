// How fresh the numbers are, decided on the page from the latest run it knows about and
// its own clock. Silence can't send a message, so the clock is what turns "fresh" into
// "stale". Pure: tested with `npm run test:lib`.

import type { WorkerRun } from "./types";

export type Connection = "connecting" | "live" | "reconnecting" | "paused";

export type Freshness =
  | { state: "loading" }
  | { state: "fresh"; feedAt: number }
  | { state: "stale"; feedAt: number | null; reason: "divvy" | "checker" | "unknown"; checkedAt: number | null }
  | { state: "down"; feedAt: number | null; reason: "divvy" | "checker" }
  | { state: "reconnecting"; feedAt: number | null };

/** Divvy publishes about every 60 s. Three missed publishes = stale. */
export const STALE_AFTER_MS = 3 * 60_000;
/** Our checker runs every 10 s; if its latest run is older than this, it has stopped. */
export const CHECKER_STOPPED_MS = 60_000;

export type FreshnessInput = {
  loaded: boolean;
  /** Latest run the page knows of (first load, then each run it hears about). */
  latest: WorkerRun | null;
  /** Divvy's time on the newest feed that was applied ok. */
  lastOkFeedAt: string | null;
  /** When stale, the page looks up the very latest run once a minute to say why. */
  probe: WorkerRun | null;
  connection: Connection;
  now: number;
};

const t = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);

/** Failures whose message is about Divvy are "can't reach Divvy"; anything else is ours. */
export const blamesDivvy = (error: string | null) => !!error && /divvy/i.test(error);

export function freshness(i: FreshnessInput): Freshness {
  if (!i.loaded) return { state: "loading" };
  const feedAt = t(i.lastOkFeedAt);

  if (i.latest && !i.latest.ok) {
    return { state: "down", feedAt, reason: blamesDivvy(i.latest.error) ? "divvy" : "checker" };
  }
  if (i.connection === "reconnecting") return { state: "reconnecting", feedAt };

  if (feedAt === null || i.now - feedAt > STALE_AFTER_MS) {
    const checkedAt = t(i.probe?.ran_at);
    let reason: "divvy" | "checker" | "unknown" = "unknown";
    if (checkedAt !== null) {
      reason = i.now - checkedAt <= CHECKER_STOPPED_MS && i.probe!.ok ? "divvy" : "checker";
    }
    return { state: "stale", feedAt, reason, checkedAt };
  }
  return { state: "fresh", feedAt };
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}
