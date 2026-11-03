// Rows as the page reads them from Supabase.

export type Station = {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  capacity: number;
  station_type: string;
  bikes: number | null; // includes e-bikes; null until the worker has seen the station
  ebikes: number | null;
  docks: number | null;
  is_installed: boolean | null;
  is_renting: boolean | null;
  is_returning: boolean | null;
  silent: boolean; // not reporting (60 min without a report, or missing from the feed)
  reported_at: string | null;
  status_changed_at: string | null;
};

export type Nearby = Station & { origin_id: string; distance_m: number };

export type Trip = {
  id: string;
  label: string;
  from_station_id: string;
  to_station_id: string;
  from_backup_ids: string[];
  to_backup_ids: string[];
  created_at: string;
};

export type WorkerRun = {
  ran_at: string;
  ok: boolean;
  feed_updated_at: string | null;
  feed_unchanged: boolean;
  error: string | null;
};

export const STATION_COLUMNS =
  "station_id,name,lat,lon,capacity,station_type,bikes,ebikes,docks,is_installed,is_renting,is_returning,silent,reported_at,status_changed_at";

export const RUN_COLUMNS = "ran_at,ok,feed_updated_at,feed_unchanged,error";
