import { test } from "node:test";
import assert from "node:assert/strict";
import { backups, bikeSplit, endState, verdict } from "./verdict.ts";
import type { Nearby, Station, Trip } from "./types.ts";

const st = (over: Partial<Station> = {}): Station => ({
  station_id: "s",
  name: "University Ave & 57th St",
  lat: 41.7915,
  lon: -87.5999,
  capacity: 15,
  station_type: "classic",
  bikes: 6,
  ebikes: 2,
  docks: 9,
  is_installed: true,
  is_renting: true,
  is_returning: true,
  silent: false,
  reported_at: "2026-11-03T05:10:00Z",
  status_changed_at: null,
  ...over,
});
const fmt = () => "11:10 PM";

test("Go when both ends have room", () => {
  const v = verdict(st(), st({ name: "Ellis Ave & 58th St" }), fmt);
  assert.equal(v.word, "Go");
  assert.equal(v.tone, "go");
  assert.equal(v.problem, null);
  assert.equal(v.line, "6 bikes at the start, 9 docks at the end");
});

test("No bikes beats everything else, and names the station", () => {
  const v = verdict(st({ bikes: 0, ebikes: 0 }), st({ docks: 0 }), fmt);
  assert.equal(v.word, "No bikes");
  assert.equal(v.problem, "start");
  assert.equal(v.line, "0 bikes at University Ave & 57th St");
});

test("No docks at the end", () => {
  const v = verdict(st(), st({ name: "Ellis Ave & 58th St", docks: 0 }), fmt);
  assert.equal(v.word, "No docks");
  assert.equal(v.problem, "end");
  assert.equal(v.line, "Ellis Ave & 58th St is full: 0 docks");
});

test("Closed is its own answer, not '0 bikes'", () => {
  assert.equal(verdict(st({ is_renting: false }), st(), fmt).word, "Closed");
  assert.equal(verdict(st(), st({ is_returning: false }), fmt).line, "University Ave & 57th St isn't taking bikes back right now");
});

test("Tight at 1–2 left, singular words", () => {
  const v = verdict(st({ bikes: 1, ebikes: 0 }), st(), fmt);
  assert.equal(v.word, "Tight");
  assert.equal(v.line, "Only 1 bike at University Ave & 57th St");
  assert.equal(verdict(st(), st({ docks: 2 }), fmt).line, "Only 2 docks at University Ave & 57th St");
});

test("Unsure when a station isn't reporting, with since-when", () => {
  const v = verdict(st({ silent: true }), st(), fmt);
  assert.equal(v.word, "Unsure");
  assert.equal(v.line, "University Ave & 57th St hasn't reported since 11:10 PM");
  assert.equal(endState(undefined, "end"), "unknown");
  assert.equal(endState(st({ bikes: null }), "start"), "unknown");
});

test("bike split says classic vs e-bike in words", () => {
  assert.equal(bikeSplit(st({ bikes: 5, ebikes: 3 })), "2 classic, 3 e-bikes");
  assert.equal(bikeSplit(st({ bikes: 2, ebikes: 2 })), "all e-bikes");
  assert.equal(bikeSplit(st({ bikes: 1, ebikes: 1 })), "an e-bike");
  assert.equal(bikeSplit(st({ bikes: 4, ebikes: 0 })), "all classic");
  assert.equal(bikeSplit(st({ bikes: 0, ebikes: 0 })), null);
});

test("backups: your own first, then the nearest that actually helps", () => {
  const trip: Trip = {
    id: "t", label: "Home → the Reg", from_station_id: "a", to_station_id: "b",
    from_backup_ids: [], to_backup_ids: ["pinned"], created_at: "",
  };
  const a = st({ station_id: "a" });
  const b = st({ station_id: "b", docks: 0, lat: 41.79, lon: -87.6 });
  const pinned = st({ station_id: "pinned", docks: 0, lat: 41.791, lon: -87.6 });
  const near = (id: string, docks: number, d: number): Nearby =>
    ({ ...st({ station_id: id, docks }), origin_id: "b", distance_m: d });
  const stations = new Map([["a", a], ["b", b], ["pinned", pinned]]);
  const list = backups(trip, "end", stations, [near("full", 0, 100), near("far", 8, 600), near("close", 3, 250)], 3);
  assert.deepEqual(list.map((x) => [x.station.station_id, x.reason]), [
    ["pinned", "Your backup"], // shown even though it's full too
    ["close", "Nearest with docks"],
    ["far", "Nearest with docks"],
  ]);
  assert.equal(list[1].walkMin, 3); // 250 m at 80 m/min
});
