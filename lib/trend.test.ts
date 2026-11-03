import { test } from "node:test";
import assert from "node:assert/strict";
import { series, sparkPath, trend } from "./trend.ts";

const NOW = Date.parse("2026-11-03T22:30:00Z");
const MIN = 60_000;
const since = NOW - 60 * MIN;

test("series: value before the first change, each change, then now", () => {
  const pts = series(
    [
      { t: NOW - 20 * MIN, before: 9, after: 7 },
      { t: NOW - 5 * MIN, before: 7, after: 5 },
    ],
    5,
    NOW,
    since,
  );
  assert.deepEqual(pts.map((p) => p.v), [9, 7, 5, 5]);
});

test("no changes in the hour: steady at the current value", () => {
  const pts = series([], 8, NOW, since);
  const t = trend(pts, NOW, "bike");
  assert.equal(t?.text, "Steady for 15 min");
  assert.equal(t?.warning, null);
});

test("falling fast: −4 in 15 min with 3 left warns it'll be out of bikes soon", () => {
  const pts = series(
    [
      { t: NOW - 14 * MIN, before: 7, after: 5 },
      { t: NOW - 6 * MIN, before: 5, after: 3 },
    ],
    3,
    NOW,
    since,
  );
  const t = trend(pts, NOW, "bike");
  assert.equal(t?.delta, -4);
  assert.equal(t?.text, "−4 bikes in 15 min");
  assert.equal(t?.warning, "At this pace, out of bikes in ~11 min"); // 3 left × 3.75 min each
});

test("docks: rising is good news, no warning; singular words", () => {
  const pts = series([{ t: NOW - 3 * MIN, before: 4, after: 5 }], 5, NOW, since);
  const t = trend(pts, NOW, "dock");
  assert.equal(t?.text, "+1 dock in 15 min");
  assert.equal(t?.warning, null);
});

test("falling slowly: no alarm", () => {
  const pts = series([{ t: NOW - 10 * MIN, before: 20, after: 19 }], 19, NOW, since);
  assert.equal(trend(pts, NOW, "dock")?.warning, null); // ~285 min away
});

test("sparkPath draws steps inside the box", () => {
  const pts = series([{ t: NOW - 30 * MIN, before: 4, after: 2 }], 2, NOW, since);
  const d = sparkPath(pts, since, NOW, 60, 16);
  assert.match(d, /^M0\.0,/);
  assert.ok(d.includes("H60.0"));
});
