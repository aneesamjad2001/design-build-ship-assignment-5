"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useSupabase } from "@/lib/useSupabase";
import { plural, walkMinutes } from "@/lib/verdict";
import { StationPicker } from "./StationPicker";
import type { PickerStation } from "./StationPicker";

type Errors = { label?: string; from?: string; to?: string; form?: string };
type Near = { station_id: string; name: string; distance_m: number };

const MAX_BACKUPS = 3;
let stationCache: PickerStation[] | null = null;

/** Dock stations for the picker. Supabase returns at most 1,000 rows per request, so page. */
async function loadStations(db: SupabaseClient): Promise<PickerStation[]> {
  if (stationCache) return stationCache;
  const out: PickerStation[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("stations")
      .select("station_id,name,lat,lon")
      .eq("station_type", "classic")
      .order("name")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as PickerStation[]));
    if (!data || data.length < 1000) break;
  }
  stationCache = out;
  return out;
}

/** Optional backups for one end: the nearest dock stations, as checkboxes. */
function BackupPicker({
  db,
  stationId,
  endName,
  kind,
  value,
  onChange,
}: {
  db: SupabaseClient | null;
  stationId: string;
  endName: string;
  kind: "start" | "end";
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [near, setNear] = useState<Near[] | null>(null);
  const [nearError, setNearError] = useState(false);
  const legendId = useId();

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    db.rpc("dockcheck_nearby", { p_station_ids: [stationId], p_radius_m: 1200, p_per_origin: 6 }).then(({ data, error }) => {
      if (cancelled) return;
      setNearError(!!error);
      setNear(((data ?? []) as Near[]).map((n) => ({ station_id: n.station_id, name: n.name, distance_m: n.distance_m })));
    });
    return () => {
      cancelled = true;
    };
  }, [db, stationId]);

  const full = value.length >= MAX_BACKUPS;
  return (
    <fieldset className="rounded-xl border border-line p-3" aria-describedby={`${legendId}-hint`}>
      <legend className="px-1 font-semibold">Backups near {endName} (optional)</legend>
      <p id={`${legendId}-hint`} className="text-sm text-muted">
        If {endName} has no {kind === "start" ? "bikes" : "docks"}, these show first on the card. Up to {MAX_BACKUPS}.
      </p>
      {near === null ? (
        <p className="mt-2 text-sm text-muted">Finding stations nearby…</p>
      ) : nearError ? (
        <p className="mt-2 text-sm text-error-text">Couldn&rsquo;t load nearby stations. You can save the trip without backups.</p>
      ) : near.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No other dock station within a 15-minute walk.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {near.map((n) => {
            const checked = value.includes(n.station_id);
            return (
              <li key={n.station_id}>
                <label className="flex items-center gap-3 py-1.5">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={checked}
                    disabled={!checked && full}
                    onChange={(e) =>
                      onChange(e.target.checked ? [...value, n.station_id] : value.filter((x) => x !== n.station_id))
                    }
                  />
                  <span className="min-w-0 flex-1">{n.name}</span>
                  <span className="shrink-0 text-sm text-muted">{plural(walkMinutes(n.distance_m), "min")} walk</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}

export function TripForm({ tripId }: { tripId?: string }) {
  const db = useSupabase();
  const router = useRouter();
  const [stations, setStations] = useState<PickerStation[] | null>(stationCache);
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [fromBackups, setFromBackups] = useState<string[]>([]);
  const [toBackups, setToBackups] = useState<string[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [loadingTrip, setLoadingTrip] = useState(!!tripId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    loadStations(db)
      .then((s) => !cancelled && setStations(s))
      .catch((e) => !cancelled && setErrors((x) => ({ ...x, form: `Couldn't load stations: ${e.message}` })));
    if (tripId) {
      db.from("trips")
        .select("label,from_station_id,to_station_id,from_backup_ids,to_backup_ids")
        .eq("id", tripId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error || !data) setErrors({ form: error ? error.message : "This trip doesn't exist, or isn't yours." });
          else {
            setLabel(data.label);
            setFrom(data.from_station_id);
            setTo(data.to_station_id);
            setFromBackups(data.from_backup_ids ?? []);
            setToBackups(data.to_backup_ids ?? []);
          }
          setLoadingTrip(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [db, tripId]);

  const nameOf = (id: string | null) => stations?.find((s) => s.station_id === id)?.name ?? "this station";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!db) return;
    const next: Errors = {};
    const clean = label.trim();
    if (!clean) next.label = "Give the trip a name, like “Home → the Reg”.";
    else if (clean.length > 60) next.label = `Keep it to 60 characters (this is ${clean.length}).`;
    if (!from) next.from = "Pick the station where you start from the list.";
    if (!to) next.to = "Pick the station where you end from the list.";
    else if (to === from) next.to = "Pick a different station from the start.";
    setErrors(next);
    if (next.label) return labelRef.current?.focus();
    if (next.from) return fromRef.current?.focus();
    if (next.to) return toRef.current?.focus();

    setSaving(true);
    const row = {
      label: clean,
      from_station_id: from!,
      to_station_id: to!,
      from_backup_ids: fromBackups.filter((x) => x !== to && x !== from),
      to_backup_ids: toBackups.filter((x) => x !== to && x !== from),
    };
    const { error } = tripId ? await db.from("trips").update(row).eq("id", tripId) : await db.from("trips").insert(row);
    setSaving(false);
    if (error) {
      if (error.code === "23505") {
        setErrors({ label: `You already have a trip called “${clean}”. Pick another name.` });
        labelRef.current?.focus();
      } else if (error.code === "23514" && /trip_goes_somewhere/.test(error.message)) {
        setErrors({ to: "Pick a different station from the start." });
        toRef.current?.focus();
      } else {
        setErrors({ form: `Couldn't save: ${error.message}` });
      }
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function onDelete() {
    if (!db || !tripId) return;
    setSaving(true);
    const { error } = await db.from("trips").delete().eq("id", tripId);
    setSaving(false);
    if (error) return setErrors({ form: `Couldn't delete: ${error.message}` });
    router.push("/");
    router.refresh();
  }

  const busy = saving || loadingTrip;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {errors.form && (
        <p role="alert" className="rounded-xl bg-no-bg px-3 py-2 font-medium text-no-text">
          {errors.form}
        </p>
      )}

      <div>
        <label htmlFor="trip-label" className="block font-semibold">
          Name this trip
        </label>
        <p id="trip-label-hint" className="text-sm text-muted">
          What you&rsquo;d call it, like &ldquo;Home → the Reg&rdquo;.
        </p>
        <input
          ref={labelRef}
          id="trip-label"
          type="text"
          maxLength={80}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-invalid={!!errors.label}
          aria-describedby={errors.label ? "trip-label-hint trip-label-error" : "trip-label-hint"}
          disabled={loadingTrip}
          className={`mt-1 w-full rounded-xl border bg-surface px-3 py-3 text-lg ${errors.label ? "border-error-text" : "border-line"}`}
        />
        {errors.label && (
          <p id="trip-label-error" className="mt-1 text-sm font-medium text-error-text">
            {errors.label}
          </p>
        )}
      </div>

      <StationPicker
        ref={fromRef}
        label="Start station"
        hint="Where you pick up the bike. Dock stations only."
        stations={stations ?? []}
        value={from}
        onChange={(id) => {
          setFrom(id);
          setFromBackups([]);
        }}
        error={errors.from}
        disabled={!stations || loadingTrip}
      />
      {from && (
        <BackupPicker db={db} stationId={from} endName={nameOf(from)} kind="start" value={fromBackups} onChange={setFromBackups} />
      )}

      <StationPicker
        ref={toRef}
        label="End station"
        hint="Where you return it. You need a free dock here."
        stations={stations ?? []}
        value={to}
        onChange={(id) => {
          setTo(id);
          setToBackups([]);
        }}
        error={errors.to}
        disabled={!stations || loadingTrip}
      />
      {to && <BackupPicker db={db} stationId={to} endName={nameOf(to)} kind="end" value={toBackups} onChange={setToBackups} />}

      <div className="flex flex-col gap-3 pt-2">
        <button
          type="submit"
          disabled={busy || !db}
          className="rounded-xl bg-accent px-4 py-3 text-lg font-semibold text-accent-text disabled:opacity-60"
        >
          {saving ? "Saving…" : tripId ? "Save changes" : "Follow this trip"}
        </button>
        <Link href="/" className="rounded-xl border border-line px-4 py-3 text-center font-semibold">
          Cancel
        </Link>
      </div>

      {tripId && !loadingTrip && (
        <div className="border-t border-line pt-5">
          {confirmDelete ? (
            <div className="space-y-3" role="group" aria-label="Confirm delete">
              <p className="font-medium">Stop following &ldquo;{label.trim() || "this trip"}&rdquo;? This can&rsquo;t be undone.</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={saving}
                  className="flex-1 rounded-xl bg-no-text px-4 py-3 font-semibold text-surface"
                >
                  Yes, delete it
                </button>
                {/* Focus lands on the safe choice when the question appears. */}
                <button
                  type="button"
                  autoFocus
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 rounded-xl border border-line px-4 py-3 font-semibold"
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="font-semibold text-error-text underline underline-offset-2">
              Delete this trip
            </button>
          )}
        </div>
      )}
    </form>
  );
}
