"use client";

import Link from "next/link";
import { FLASH_MS, HISTORY_MS } from "@/lib/useDockData";
import type { Change, Flash } from "@/lib/useDockData";
import { series, sparkPath, trend } from "@/lib/trend";
import { backups, bikeSplit, endState, plural, verdict } from "@/lib/verdict";
import type { Backup, EndKind } from "@/lib/verdict";
import type { Nearby, Station, Trip } from "@/lib/types";
import { clock } from "./StatusBar";
import { VerdictBadge } from "./VerdictBadge";

type Props = {
  trip: Trip;
  stations: Map<string, Station>;
  nearby: Nearby[];
  flashes: Map<string, Flash>;
  history: Map<string, Change[]>;
  now: number;
  dimmed: boolean;
};

const fmt = (iso: string) => clock(Date.parse(iso));

/** A number that briefly glows when it changes (still outline with reduced motion). */
function Num({ value, flash, now, field }: { value: number; flash?: Flash; now: number; field: "bikes" | "docks" }) {
  const on = !!flash && flash[field] && now - flash.at < FLASH_MS;
  return (
    <span key={on ? flash!.at : "still"} className={`px-0.5 font-semibold tabular-nums ${on ? "flash" : ""}`}>
      {value}
    </span>
  );
}

/** The last hour at one end: a step sparkline, the 15-minute change in words, and a
 *  warning only when it'll run out soon. The words carry it; the line only illustrates. */
function TrendLine({ kind, s, changes, now }: { kind: EndKind; s: Station; changes: Change[] | undefined; now: number }) {
  if (!changes || now === 0) return null;
  const field = kind === "start" ? "bikes" : "docks";
  const since = now - HISTORY_MS;
  const pts = series(
    changes.map((c) => ({ t: c.t, before: c[`${field}_before`], after: c[`${field}_after`] })),
    s[field],
    now,
    since,
  );
  const t = trend(pts, now, kind === "start" ? "bike" : "dock");
  if (!t) return null;
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
      <svg viewBox="0 0 60 16" className="h-4 w-[60px] shrink-0" aria-hidden>
        <path d={sparkPath(pts, since, now, 60, 16)} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span>{t.text}</span>
      {t.warning && <span className="font-semibold text-tight-text">{t.warning}</span>}
    </span>
  );
}

/** One end of the trip, in words: what it has, or why we can't say. */
function EndRow({ kind, s, flash, now, changes }: { kind: EndKind; s: Station | undefined; flash?: Flash; now: number; changes?: Change[] }) {
  const label = kind === "start" ? "From" : "To";
  const state = endState(s, kind);
  let body: React.ReactNode;
  if (!s) body = <span className="text-muted">Station not found</span>;
  else if (state === "unknown")
    body = <span>Not reporting{s.reported_at ? ` since ${fmt(s.reported_at)}` : ""}</span>;
  else if (state === "closed")
    body = <span>Closed{kind === "start" ? " for rentals" : " for returns"}</span>;
  else if (kind === "start") {
    const split = bikeSplit(s);
    body = (
      <span>
        <Num value={s.bikes!} flash={flash} now={now} field="bikes" /> {s.bikes === 1 ? "bike" : "bikes"}
        {split && <span className="text-muted"> ({split})</span>}
      </span>
    );
  } else {
    body = (
      <span>
        <Num value={s.docks!} flash={flash} now={now} field="docks" /> {s.docks === 1 ? "free dock" : "free docks"}
        <span className="text-muted"> of {s.capacity}</span>
      </span>
    );
  }
  return (
    <div className="flex gap-3 py-1.5">
      <dt className="w-10 shrink-0 text-sm font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="min-w-0">
        <span className="block truncate font-medium">{s?.name ?? "Unknown station"}</span>
        {body}
        {s && state !== "unknown" && state !== "closed" && <TrendLine kind={kind} s={s} changes={changes} now={now} />}
      </dd>
    </div>
  );
}

function BackupList({ kind, list, flashes, now }: { kind: EndKind; list: Backup[]; flashes: Map<string, Flash>; now: number }) {
  const what = kind === "start" ? "bikes" : "docks";
  if (list.length === 0) {
    return <p className="mt-3 text-sm text-muted">No dock station within a 15-minute walk has {what} right now.</p>;
  }
  return (
    <section className="mt-3 border-t border-line pt-3" aria-label={`Backups with ${what}`}>
      <h3 className="mb-1 text-sm font-semibold">{kind === "start" ? "Bikes nearby" : "Docks nearby"}</h3>
      <ul className="space-y-1.5">
        {list.map((b) => {
          const n = kind === "start" ? b.station.bikes : b.station.docks;
          const usable = b.state === "ok" || b.state === "few";
          return (
            <li key={b.station.station_id} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate">{b.station.name}</span>
                <span className="text-xs text-muted">{b.reason}</span>
              </span>
              <span className="shrink-0 text-right">
                {usable && n !== null ? (
                  <>
                    <Num value={n} flash={flashes.get(b.station.station_id)} now={now} field={what} /> {n === 1 ? what.slice(0, -1) : what}
                  </>
                ) : (
                  <span className="text-muted">{b.state === "unknown" ? "not reporting" : b.state === "closed" ? "closed" : `0 ${what}`}</span>
                )}
                <span className="block text-xs text-muted">{plural(b.walkMin, "min")} walk</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function TripCard({ trip, stations, nearby, flashes, history, now, dimmed }: Props) {
  const from = stations.get(trip.from_station_id);
  const to = stations.get(trip.to_station_id);
  const v = verdict(from, to, fmt);
  const list = v.problem ? backups(trip, v.problem, stations, nearby) : [];
  const titleId = `trip-${trip.id}`;

  return (
    <article
      aria-labelledby={titleId}
      // 80%, not lower: dimmed muted text must still pass AA (scripts/contrast.mjs checks it)
      className={`rounded-2xl border border-line bg-surface p-4 shadow-sm transition-opacity ${dimmed ? "opacity-80" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={titleId} className="min-w-0 truncate text-lg font-semibold">
          {trip.label}
        </h2>
        <Link
          href={`/trips/${trip.id}`}
          className="-my-1 shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-accent underline-offset-2 hover:underline"
          aria-label={`Edit ${trip.label}`}
        >
          Edit
        </Link>
      </div>

      {/* The answer: one big word and one number. Only the word is announced when it
          changes (Go → No docks); every count change would be constant noise. */}
      <div aria-live="polite" aria-atomic="true">
        <VerdictBadge tone={v.tone} word={v.word} />
      </div>
      <p className="mt-1.5 text-base">{v.line}</p>

      <dl className="mt-3 divide-y divide-line border-t border-line pt-1">
        <EndRow kind="start" s={from} flash={flashes.get(trip.from_station_id)} now={now} changes={history.get(trip.from_station_id)} />
        <EndRow kind="end" s={to} flash={flashes.get(trip.to_station_id)} now={now} changes={history.get(trip.to_station_id)} />
      </dl>

      {v.problem && <BackupList kind={v.problem} list={list} flashes={flashes} now={now} />}
    </article>
  );
}
