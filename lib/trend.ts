// Where a station is heading, from the before → after history the worker logs in
// station_changes. Pure: tested with `npm run test:lib`.

export type Point = { t: number; v: number };

/** Looking back this far for "−4 bikes in 15 min". */
export const TREND_WINDOW_MS = 15 * 60_000;
/** Only warn "empty in ~N min" when it's this soon. */
export const SOON_MS = 30 * 60_000;

/**
 * A station's value over time: the value before the first change in the window, each
 * change's new value, and the current value now. `changes` are oldest first.
 */
export function series(
  changes: { t: number; before: number | null; after: number | null }[],
  current: number | null,
  now: number,
  since: number,
): Point[] {
  const pts: Point[] = [];
  const inWindow = changes.filter((c) => c.t >= since && c.after !== null);
  if (inWindow.length && inWindow[0].before !== null) pts.push({ t: since, v: inWindow[0].before });
  for (const c of inWindow) pts.push({ t: c.t, v: c.after! });
  if (current !== null) {
    if (pts.length === 0) pts.push({ t: since, v: current });
    pts.push({ t: now, v: current });
  }
  return pts;
}

/** The value at time t (the last point at or before it). */
function valueAt(pts: Point[], t: number): number | null {
  let v: number | null = null;
  for (const p of pts) if (p.t <= t) v = p.v;
  return v;
}

export type Trend = {
  /** Change over the last 15 min, e.g. -4. */
  delta: number;
  /** "−4 bikes in 15 min", or "Steady for 15 min". */
  text: string;
  /** "At this pace, empty in ~8 min", only when soon and still falling. */
  warning: string | null;
};

export function trend(pts: Point[], now: number, unit: "bike" | "dock"): Trend | null {
  if (pts.length === 0) return null;
  const then = valueAt(pts, now - TREND_WINDOW_MS) ?? pts[0].v;
  const current = pts[pts.length - 1].v;
  const delta = current - then;
  const word = (n: number) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  const text =
    delta === 0 ? "Steady for 15 min" : `${delta > 0 ? "+" : "−"}${word(Math.abs(delta))} in 15 min`;

  let warning: string | null = null;
  if (delta < 0 && current > 0) {
    const msPerUnit = TREND_WINDOW_MS / Math.abs(delta);
    const msToZero = current * msPerUnit;
    if (msToZero <= SOON_MS) {
      const what = unit === "bike" ? "out of bikes" : "full";
      warning = `At this pace, ${what} in ~${Math.max(1, Math.round(msToZero / 60_000))} min`;
    }
  }
  return { delta, text, warning };
}

/** SVG path for a small step sparkline in a w × h box. */
export function sparkPath(pts: Point[], since: number, now: number, w: number, h: number): string {
  if (pts.length === 0) return "";
  const max = Math.max(1, ...pts.map((p) => p.v));
  const x = (t: number) => ((t - since) / Math.max(1, now - since)) * w;
  const y = (v: number) => h - 1 - (v / max) * (h - 2);
  let d = `M${x(pts[0].t).toFixed(1)},${y(pts[0].v).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` H${x(pts[i].t).toFixed(1)} V${y(pts[i].v).toFixed(1)}`;
  }
  return d;
}
