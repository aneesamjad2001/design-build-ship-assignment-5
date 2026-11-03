// Reading Divvy's GBFS v1.1 feeds. Pure functions: no Deno, no network, no database,
// so they run the same under Deno (deployed) and Node (tests against docs/source-samples).

export const STATUS_URL = "https://gbfs.divvybikes.com/gbfs/en/station_status.json";
export const INFO_URL = "https://gbfs.divvybikes.com/gbfs/en/station_information.json";

/** One station's live counts, shaped for public.apply_station_status. */
export type StatusRow = {
  station_id: string;
  bikes: number; // num_bikes_available: classic + e-bikes
  ebikes: number;
  docks: number;
  bikes_disabled: number;
  docks_disabled: number;
  is_installed: boolean;
  is_renting: boolean;
  is_returning: boolean;
  reported_at: string; // ISO time of last_reported (a heartbeat, not a change signal)
};

/** One station's slow facts, shaped for public.apply_station_information. */
export type InfoRow = {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  capacity: number;
  station_type: string;
};

export type Parsed<T> = {
  feedUpdatedAt: string; // ISO time of the feed's last_updated
  rows: T[];
  total: number; // entries in the feed, valid or not
  rejected: number; // entries skipped because they failed validation
};

/** The feed itself is unusable (not a station list, or no timestamp). Fails the run. */
export class FeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedError";
  }
}

// A station claiming to report from the future is wrong. Allow a little clock skew.
const FUTURE_SKEW_MS = 5 * 60 * 1000;

function envelope(json: unknown): { lastUpdated: number; stations: unknown[] } {
  const j = json as { last_updated?: unknown; data?: { stations?: unknown } } | null;
  if (!j || typeof j !== "object") throw new FeedError("Divvy sent something that isn't JSON");
  if (typeof j.last_updated !== "number" || !Number.isFinite(j.last_updated) || j.last_updated <= 0) {
    throw new FeedError("Divvy's feed has no last_updated time");
  }
  if (!Array.isArray(j.data?.stations)) {
    throw new FeedError("Divvy's feed has no data.stations list (did the format change?)");
  }
  return { lastUpdated: j.last_updated, stations: j.data.stations };
}

const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const flag = (v: unknown): boolean | null =>
  v === 1 || v === true ? true : v === 0 || v === false ? false : null;
const id = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

export function parseStatus(json: unknown, nowMs: number): Parsed<StatusRow> {
  const { lastUpdated, stations } = envelope(json);
  const byId = new Map<string, StatusRow>();
  let rejected = 0;

  for (const raw of stations) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const station_id = id(s.station_id);
    const bikes = s.num_bikes_available;
    const ebikes = s.num_ebikes_available;
    const docks = s.num_docks_available;
    const bikes_disabled = s.num_bikes_disabled ?? 0;
    const docks_disabled = s.num_docks_disabled ?? 0;
    const is_installed = flag(s.is_installed);
    const is_renting = flag(s.is_renting);
    const is_returning = flag(s.is_returning);
    const last = s.last_reported;

    const valid =
      station_id !== null &&
      count(bikes) && count(ebikes) && count(docks) &&
      count(bikes_disabled) && count(docks_disabled) &&
      ebikes <= bikes &&
      is_installed !== null && is_renting !== null && is_returning !== null &&
      typeof last === "number" && Number.isFinite(last) && last > 0 &&
      last * 1000 <= nowMs + FUTURE_SKEW_MS;

    if (!valid || byId.has(station_id)) {
      rejected++;
      continue;
    }

    byId.set(station_id, {
      station_id,
      bikes,
      ebikes,
      docks,
      bikes_disabled,
      docks_disabled,
      is_installed,
      is_renting,
      is_returning,
      reported_at: new Date(last * 1000).toISOString(),
    });
  }

  return {
    feedUpdatedAt: new Date(lastUpdated * 1000).toISOString(),
    rows: [...byId.values()],
    total: stations.length,
    rejected,
  };
}

export function parseInformation(json: unknown): Parsed<InfoRow> {
  const { lastUpdated, stations } = envelope(json);
  const byId = new Map<string, InfoRow>();
  let rejected = 0;

  for (const raw of stations) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const station_id = id(s.station_id);
    const name = typeof s.name === "string" ? s.name.trim() : "";
    const lat = s.lat;
    const lon = s.lon;
    const capacity = s.capacity ?? 0;
    const station_type = typeof s.station_type === "string" && s.station_type ? s.station_type : "classic";

    const valid =
      station_id !== null &&
      name !== "" &&
      typeof lat === "number" && lat >= -90 && lat <= 90 &&
      typeof lon === "number" && lon >= -180 && lon <= 180 &&
      count(capacity);

    if (!valid || byId.has(station_id)) {
      rejected++;
      continue;
    }

    byId.set(station_id, { station_id, name, lat, lon, capacity, station_type });
  }

  return {
    feedUpdatedAt: new Date(lastUpdated * 1000).toISOString(),
    rows: [...byId.values()],
    total: stations.length,
    rejected,
  };
}
