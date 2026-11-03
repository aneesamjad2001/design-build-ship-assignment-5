"use client";

import { ago } from "@/lib/freshness";
import type { Freshness } from "@/lib/freshness";

export const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * How fresh the numbers are, always on screen. The state word is announced to screen
 * readers when it changes; the ticking "40 s ago" next to it is not (it would never stop).
 */
export function StatusBar({ f, now }: { f: Freshness; now: number }) {
  const since = (t: number | null) => (t ? clock(t) : "earlier");
  let word: string;
  let detail: string;
  let dot: string;

  switch (f.state) {
    case "loading":
      word = "Loading";
      detail = "Getting live numbers…";
      dot = "bg-muted";
      break;
    case "fresh":
      word = "Live";
      detail = `Divvy updated ${ago(now - f.feedAt)}`;
      dot = "bg-go-text";
      break;
    case "stale":
      word = "Stale";
      detail =
        f.reason === "divvy"
          ? `Divvy hasn't published since ${since(f.feedAt)}. Numbers may be out of date.`
          : f.reason === "checker"
            ? `Our checker stopped at ${since(f.checkedAt)}. Numbers may be out of date.`
            : `Last update ${since(f.feedAt)}. Numbers may be out of date.`;
      dot = "bg-tight-text";
      break;
    case "down":
      word = "Down";
      detail =
        f.reason === "divvy"
          ? `Can't reach Divvy right now. Showing numbers from ${since(f.feedAt)}.`
          : `Our checker hit a problem. Showing numbers from ${since(f.feedAt)}.`;
      dot = "bg-no-text";
      break;
    case "reconnecting":
      word = "Reconnecting…";
      detail = `Showing numbers from ${since(f.feedAt)}.`;
      dot = "bg-unsure-text";
      break;
  }

  return (
    <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur">
      <p className="flex items-baseline gap-2 text-sm">
        <span className={`inline-block h-2.5 w-2.5 shrink-0 translate-y-[-1px] rounded-full ${dot}`} aria-hidden />
        <span role="status" className="font-semibold">
          {word}
        </span>
        <span className="text-muted">{detail}</span>
      </p>
    </div>
  );
}
