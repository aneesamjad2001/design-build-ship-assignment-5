// node --test supabase/functions/poll-divvy/   (Node strips the types; no Deno needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FeedError, parseInformation, parseStatus } from "./divvy.ts";

const samples = join(import.meta.dirname, "../../../docs/source-samples");
const load = (name: string) => JSON.parse(readFileSync(join(samples, name), "utf8"));

const status827 = load("station_status.2026-11-02T2027.json");
const info = load("station_information.2026-11-02.json");
const NOW = Date.parse("2026-11-03T02:28:00Z"); // just after the 8:27 PM sample

test("parses the 8:27 PM sample: every station, nothing rejected", () => {
  const p = parseStatus(status827, NOW);
  assert.equal(p.total, 22);
  assert.equal(p.rows.length, 22);
  assert.equal(p.rejected, 0);
  assert.equal(p.feedUpdatedAt, new Date(status827.last_updated * 1000).toISOString());
});

test("University Ave & 57th St: the change Step 1 recorded (bikes 0, docks 47)", () => {
  const row = parseStatus(status827, NOW).rows.find((r) => r.station_id === "a3ad8072-a135-11e9-9cda-0a87ae2ba916");
  assert.ok(row);
  assert.equal(row.bikes, 0);
  assert.equal(row.docks, 47);
  assert.equal(typeof row.is_renting, "boolean");
  assert.match(row.reported_at, /^\d{4}-\d\d-\d\dT/);
});

test("bad rows are skipped and counted, good rows kept", () => {
  const good = status827.data.stations[0];
  const feed = {
    last_updated: status827.last_updated,
    data: {
      stations: [
        good,
        { ...good }, // duplicate id
        { ...good, station_id: "neg", num_bikes_available: -1 },
        { ...good, station_id: "ebikes", num_bikes_available: 1, num_ebikes_available: 2 },
        { ...good, station_id: "str", num_docks_available: "5" },
        { ...good, station_id: "future", last_reported: NOW / 1000 + 3600 },
        { ...good, station_id: "" },
        { ...good, station_id: "flag", is_renting: "yes" },
        { ...good, station_id: "nodisabled", num_bikes_disabled: undefined }, // missing ≠ 0
        null,
      ],
    },
  };
  const p = parseStatus(feed, NOW);
  assert.equal(p.total, 10);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rejected, 9);
});

test("a feed in another shape (e.g. GBFS v3) is a FeedError, not zero stations", () => {
  assert.throws(() => parseStatus({ last_updated: "2026-11-03T02:27:41Z", data: { stations: [] } }, NOW), FeedError);
  assert.throws(() => parseStatus({ last_updated: 1793000000, data: {} }, NOW), FeedError);
  assert.throws(() => parseStatus(null, NOW), FeedError);
});

test("station info: names trimmed, all 22 kept", () => {
  const p = parseInformation(info);
  assert.equal(p.rows.length, 22);
  assert.equal(p.rejected, 0);
  const glenlake = p.rows.find((r) => r.name.startsWith("Broadway & Glenlake"));
  assert.equal(glenlake?.name, "Broadway & Glenlake Ave"); // the feed has two trailing spaces
});

test("station info: a station without a place is rejected", () => {
  const s = info.data.stations[0];
  const p = parseInformation({ last_updated: info.last_updated, data: { stations: [s, { ...s, station_id: "x", lat: "41.8" }] } });
  assert.equal(p.rows.length, 1);
  assert.equal(p.rejected, 1);
});

test("station info: missing capacity or type is rejected, not guessed", () => {
  const s = info.data.stations[0];
  const p = parseInformation({
    last_updated: info.last_updated,
    data: { stations: [s, { ...s, station_id: "nocap", capacity: undefined }, { ...s, station_id: "notype", station_type: undefined }] },
  });
  assert.equal(p.rows.length, 1);
  assert.equal(p.rejected, 2);
});
