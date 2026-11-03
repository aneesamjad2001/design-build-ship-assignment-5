import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, freshness } from "./freshness.ts";
import type { FreshnessInput } from "./freshness.ts";

const NOW = Date.parse("2026-11-03T05:45:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const ok = (msAgo: number) => ({ ran_at: iso(msAgo), ok: true, feed_updated_at: iso(msAgo + 11_000), feed_unchanged: false, error: null });
const base: FreshnessInput = { loaded: true, latest: ok(5_000), lastOkFeedAt: iso(16_000), probe: null, connection: "live", now: NOW };

test("loading before the first read", () => {
  assert.equal(freshness({ ...base, loaded: false }).state, "loading");
});

test("fresh when Divvy's newest applied feed is under 3 min old", () => {
  assert.equal(freshness(base).state, "fresh");
  assert.equal(freshness({ ...base, lastOkFeedAt: iso(170_000) }).state, "fresh");
});

test("stale after 3 min of silence, with no message needed", () => {
  const f = freshness({ ...base, lastOkFeedAt: iso(190_000) });
  assert.equal(f.state, "stale");
});

test("stale says why: Divvy stopped publishing vs our checker stopped", () => {
  const divvy = freshness({ ...base, lastOkFeedAt: iso(300_000), probe: { ...ok(4_000), feed_unchanged: true } });
  assert.deepEqual(divvy.state === "stale" && divvy.reason, "divvy");
  const checker = freshness({ ...base, lastOkFeedAt: iso(300_000), probe: ok(290_000) });
  assert.deepEqual(checker.state === "stale" && checker.reason, "checker");
});

test("down when the latest run failed, and who to blame", () => {
  const f = freshness({ ...base, latest: { ...ok(3_000), ok: false, error: "Divvy didn't answer within 8 s" } });
  assert.equal(f.state, "down");
  assert.equal(f.state === "down" && f.reason, "divvy");
  const ours = freshness({ ...base, latest: { ...ok(3_000), ok: false, error: "Database rpc/apply_station_status: HTTP 503" } });
  assert.equal(ours.state === "down" && ours.reason, "checker");
});

test("down outranks reconnecting; reconnecting outranks fresh", () => {
  assert.equal(freshness({ ...base, connection: "reconnecting" }).state, "reconnecting");
  assert.equal(freshness({ ...base, connection: "reconnecting", latest: { ...ok(1), ok: false, error: "Divvy returned HTTP 503" } }).state, "down");
});

test("returning to the tab (re-reading) says Reconnecting, not Stale", () => {
  assert.equal(freshness({ ...base, connection: "connecting", lastOkFeedAt: iso(600_000) }).state, "reconnecting");
});

test("a Divvy format change is blamed on Divvy, not on us", () => {
  const f = freshness({ ...base, latest: { ...ok(3_000), ok: false, error: "712 of 2079 stations failed validation" } });
  assert.equal(f.state === "down" && f.reason, "divvy");
});

test("ago reads naturally", () => {
  assert.equal(ago(40_000), "40 s ago");
  assert.equal(ago(150_000), "3 min ago");
  assert.equal(ago(2 * 3600_000), "2 h ago");
});
