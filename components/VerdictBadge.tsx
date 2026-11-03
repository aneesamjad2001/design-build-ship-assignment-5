import type { Tone } from "@/lib/verdict";

const TONE: Record<Tone, string> = {
  go: "bg-go-bg text-go-text",
  tight: "bg-tight-bg text-tight-text",
  no: "bg-no-bg text-no-text",
  unsure: "bg-unsure-bg text-unsure-text",
};

/** Each tone has its own shape too, so it never depends on color alone. */
function Icon({ tone }: { tone: Tone }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8 shrink-0" aria-hidden>
      {tone === "go" && <path d="M5 12.5l4.5 4.5L19 7.5" {...common} />}
      {tone === "tight" && (
        <>
          <path d="M12 6v8" {...common} />
          <path d="M12 18.5v.01" {...common} />
        </>
      )}
      {tone === "no" && <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" {...common} />}
      {tone === "unsure" && (
        <>
          <path d="M9 9a3 3 0 1 1 4.2 2.75c-.75.35-1.2 1.05-1.2 1.85V14" {...common} />
          <path d="M12 18.5v.01" {...common} />
        </>
      )}
    </svg>
  );
}

export function VerdictBadge({ tone, word, size = "lg" }: { tone: Tone; word: string; size?: "lg" | "sm" }) {
  return (
    <span
      className={`mt-2 inline-flex items-center gap-2 rounded-xl px-3 py-1.5 font-bold ${TONE[tone]} ${
        size === "lg" ? "text-4xl" : "text-base"
      }`}
    >
      <Icon tone={tone} />
      {word}
    </span>
  );
}
