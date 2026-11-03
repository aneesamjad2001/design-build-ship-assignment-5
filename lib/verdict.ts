// What a trip card says. Pure: tested with `npm run test:lib`.
// Rule from AGENTS.md: one big word and one number, and the word carries the meaning
// (color only repeats it).

import type { Nearby, Station, Trip } from "./types";

export type EndKind = "start" | "end";
export type EndState = "ok" | "few" | "none" | "closed" | "unknown";
export type Tone = "go" | "tight" | "no" | "unsure";

/** At or below this many bikes (start) or docks (end), a trip is "Tight". */
export const FEW = 2;
/** Walking pace for "3 min walk": 80 m a minute, about 4.8 km/h. */
const WALK_M_PER_MIN = 80;

export function endState(s: Station | undefined, kind: EndKind): EndState {
  if (!s || s.silent || s.bikes === null || s.docks === null) return "unknown";
  if (s.is_installed === false) return "closed";
  if (kind === "start" ? s.is_renting === false : s.is_returning === false) return "closed";
  const n = kind === "start" ? s.bikes : s.docks;
  if (n === 0) return "none";
  if (n <= FEW) return "few";
  return "ok";
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "5 bikes" plus the split, because e-bikes cost extra: "2 classic, 3 e-bikes". */
export function bikeSplit(s: Station): string | null {
  if (s.bikes === null || s.ebikes === null || s.bikes === 0) return null;
  const classic = s.bikes - s.ebikes;
  if (s.ebikes === 0) return "all classic";
  if (classic === 0) return s.ebikes === 1 ? "an e-bike" : "all e-bikes";
  return `${classic} classic, ${plural(s.ebikes, "e-bike")}`;
}

export type Verdict = {
  word: "Go" | "Tight" | "No bikes" | "No docks" | "Closed" | "Unsure";
  tone: Tone;
  /** The one number, in words: "2 bikes left at University Ave & 57th St". */
  line: string;
  /** Which end needs a backup, if any. */
  problem: EndKind | null;
};

export function verdict(
  from: Station | undefined,
  to: Station | undefined,
  formatTime: (iso: string) => string,
): Verdict {
  const a = endState(from, "start");
  const b = endState(to, "end");
  const fromName = from?.name ?? "the start";
  const toName = to?.name ?? "the end";
  const silentLine = (s: Station | undefined, name: string) =>
    s?.reported_at ? `${name} hasn't reported since ${formatTime(s.reported_at)}` : `${name} isn't reporting`;

  // Can't even start: say that first.
  if (a === "none") return { word: "No bikes", tone: "no", line: `0 bikes at ${fromName}`, problem: "start" };
  if (a === "closed") return { word: "Closed", tone: "no", line: `${fromName} isn't renting bikes right now`, problem: "start" };
  if (b === "none") return { word: "No docks", tone: "no", line: `${toName} is full: 0 docks`, problem: "end" };
  if (b === "closed") return { word: "Closed", tone: "no", line: `${toName} isn't taking bikes back right now`, problem: "end" };
  if (a === "unknown") return { word: "Unsure", tone: "unsure", line: silentLine(from, fromName), problem: "start" };
  if (b === "unknown") return { word: "Unsure", tone: "unsure", line: silentLine(to, toName), problem: "end" };

  const bikes = from!.bikes!;
  const docks = to!.docks!;
  if (a === "few") return { word: "Tight", tone: "tight", line: `Only ${plural(bikes, "bike")} at ${fromName}`, problem: "start" };
  if (b === "few") return { word: "Tight", tone: "tight", line: `Only ${plural(docks, "dock")} at ${toName}`, problem: "end" };
  return { word: "Go", tone: "go", line: `${plural(bikes, "bike")} at the start, ${plural(docks, "dock")} at the end`, problem: null };
}

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

export const walkMinutes = (m: number) => Math.max(1, Math.round(m / WALK_M_PER_MIN));

export type Backup = {
  station: Station;
  walkMin: number;
  state: EndState;
  /** Why it's shown, in words: no surprise UI. */
  reason: "Your backup" | "Nearest with bikes" | "Nearest with docks";
};

/**
 * Backups for the end that has a problem. The person's own backups come first (shown even
 * if they can't help, so they aren't left wondering where they went), then the nearest
 * stations that would actually solve it, up to `max` in all.
 */
export function backups(
  trip: Trip,
  problem: EndKind,
  stations: Map<string, Station>,
  nearby: Nearby[],
  max = 2,
): Backup[] {
  const origin = stations.get(problem === "start" ? trip.from_station_id : trip.to_station_id);
  if (!origin) return [];
  const pinnedIds = problem === "start" ? trip.from_backup_ids : trip.to_backup_ids;
  const skip = new Set([trip.from_station_id, trip.to_station_id]);
  const out: Backup[] = [];

  for (const id of pinnedIds) {
    const s = stations.get(id) ?? nearby.find((n) => n.station_id === id);
    if (!s || skip.has(id)) continue;
    skip.add(id);
    out.push({ station: s, walkMin: walkMinutes(distanceM(origin, s)), state: endState(s, problem), reason: "Your backup" });
  }

  const helps = (st: EndState) => st === "ok" || st === "few";
  const candidates = nearby
    .filter((n) => n.origin_id === origin.station_id && !skip.has(n.station_id) && helps(endState(n, problem)))
    .sort((x, y) => x.distance_m - y.distance_m);
  for (const n of candidates) {
    if (out.length >= max) break;
    out.push({
      station: n,
      walkMin: walkMinutes(n.distance_m),
      state: endState(n, problem),
      reason: problem === "start" ? "Nearest with bikes" : "Nearest with docks",
    });
  }
  return out;
}
