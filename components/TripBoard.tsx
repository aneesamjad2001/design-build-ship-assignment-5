"use client";

import Link from "next/link";
import { useDockData, MAX_TRIPS } from "@/lib/useDockData";
import { useSupabase } from "@/lib/useSupabase";
import { StatusBar } from "./StatusBar";
import { TripCard } from "./TripCard";

/** Placeholders shaped like the trip cards, so the page doesn't jump when numbers arrive. */
function Skeletons() {
  return (
    <ul className="space-y-4" aria-busy="true" aria-label="Loading your trips">
      {[0, 1].map((i) => (
        <li key={i} className="skeleton animate-pulse rounded-2xl border border-line bg-surface p-4">
          <div className="h-5 w-40 rounded bg-line" />
          <div className="mt-3 h-11 w-32 rounded-xl bg-line" />
          <div className="mt-2 h-4 w-56 rounded bg-line" />
          <div className="mt-4 h-10 w-full rounded bg-line" />
        </li>
      ))}
    </ul>
  );
}

export function TripBoard() {
  const supabase = useSupabase();
  const data = useDockData(supabase);
  const f = data.freshness;
  const dimmed = f.state === "stale" || f.state === "down" || f.state === "reconnecting";
  const atLimit = data.trips.length >= MAX_TRIPS;

  return (
    <>
      <StatusBar f={f} now={data.now} />
      <h1 className="sr-only">Your trips</h1>

      {f.state === "loading" ? (
        <Skeletons />
      ) : data.loadError && data.trips.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="font-semibold">Couldn&rsquo;t load your trips.</p>
          <p className="mt-1 text-sm text-muted">{data.loadError}</p>
          <button
            type="button"
            onClick={data.reload}
            className="mt-3 rounded-xl bg-accent px-4 py-2 font-semibold text-accent-text"
          >
            Try again
          </button>
        </div>
      ) : data.trips.length === 0 ? (
        <div className="space-y-4 py-6 text-center">
          <p className="text-xl font-semibold">You&rsquo;re not following any trips yet.</p>
          <p className="text-muted">Add the trip you make most, like home to class, and see it live here.</p>
          <Link
            href="/trips/new"
            className="inline-block rounded-xl bg-accent px-5 py-3 text-lg font-semibold text-accent-text"
          >
            Add your first trip
          </Link>
        </div>
      ) : (
        <>
          <ul className="space-y-4">
            {data.trips.map((t) => (
              <li key={t.id}>
                <TripCard
                  trip={t}
                  stations={data.stations}
                  nearby={data.nearby}
                  flashes={data.flashes}
                  history={data.history}
                  now={data.now}
                  dimmed={dimmed}
                />
              </li>
            ))}
          </ul>
          <div className="mt-6">
            {atLimit ? (
              <p className="text-center text-sm text-muted">
                You&rsquo;re following {MAX_TRIPS} trips, the most Dockcheck keeps live at once. Edit one to change it.
              </p>
            ) : (
              <Link
                href="/trips/new"
                className="block rounded-xl border border-line bg-surface px-4 py-3 text-center font-semibold"
              >
                Add a trip
              </Link>
            )}
          </div>
        </>
      )}
    </>
  );
}
