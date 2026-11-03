"use client";

import { forwardRef, useEffect, useId, useMemo, useState } from "react";

export type PickerStation = { station_id: string; name: string; lat: number; lon: number };

type Props = {
  label: string;
  hint?: string;
  stations: PickerStation[];
  value: string | null;
  onChange: (id: string | null) => void;
  error?: string;
  disabled?: boolean;
};

const MAX_MATCHES = 8;
const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** A searchable list of dock stations (WAI-ARIA combobox: arrows, Enter, Escape). */
export const StationPicker = forwardRef<HTMLInputElement, Props>(function StationPicker(
  { label, hint, stations, value, onChange, error, disabled },
  ref,
) {
  const id = useId();
  const selected = stations.find((s) => s.station_id === value) ?? null;
  const [typed, setTyped] = useState<string | null>(null); // null = show the selected name
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = typed ?? selected?.name ?? "";

  const matches = useMemo(() => {
    const words = norm(query).split(" ").filter(Boolean);
    if (words.length === 0) return [];
    return stations.filter((s) => {
      const n = norm(s.name);
      return words.every((w) => n.includes(w));
    }).slice(0, MAX_MATCHES);
  }, [query, stations]);

  const showList = open && typed !== null && matches.length > 0;

  // Arrowing down past the bottom of the list keeps the highlighted station in view.
  useEffect(() => {
    if (showList) document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [showList, active, id]);
  const choose = (s: PickerStation) => {
    onChange(s.station_id);
    setTyped(null);
    setOpen(false);
  };

  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="relative">
      <label htmlFor={`${id}-input`} className="block font-semibold">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      <input
        ref={ref}
        id={`${id}-input`}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-activedescendant={showList ? `${id}-opt-${active}` : undefined}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        autoComplete="off"
        disabled={disabled}
        placeholder={disabled ? "Loading stations…" : "Type a street, e.g. Ellis 58th"}
        value={query}
        onChange={(e) => {
          setTyped(e.target.value);
          setActive(0);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && matches.length) {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp" && matches.length) {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && showList) {
            e.preventDefault();
            choose(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={`mt-1 w-full rounded-xl border bg-surface px-3 py-3 text-lg ${error ? "border-error-text" : "border-line"}`}
      />
      <ul
        id={`${id}-list`}
        role="listbox"
        aria-label={`${label}: matching stations`}
        hidden={!showList}
        className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-surface py-1 shadow-lg"
      >
        {matches.map((s, i) => (
          <li
            key={s.station_id}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            // mousedown, not click: it fires before the input's blur closes the list
            onMouseDown={(e) => {
              e.preventDefault();
              choose(s);
            }}
            onMouseEnter={() => setActive(i)}
            className={`cursor-pointer px-3 py-2.5 ${i === active ? "bg-unsure-bg" : ""}`}
          >
            {s.name}
          </li>
        ))}
      </ul>
      {open && typed !== null && norm(typed) !== "" && matches.length === 0 && (
        <p className="mt-1 text-sm text-muted" role="status">
          No dock station matches &ldquo;{typed}&rdquo;.
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-medium text-error-text">
          {error}
        </p>
      )}
    </div>
  );
});
