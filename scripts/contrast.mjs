// Checks every text/background pair the page uses, in light and dark, against WCAG AA.
// Reads the tokens straight from app/globals.css so the check can't drift from the CSS.
// Run: node scripts/contrast.mjs
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const block = (re) => Object.fromEntries([...(css.match(re)?.[1] ?? "").matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const light = block(/:root \{([^}]*)\}/);
const dark = block(/prefers-color-scheme: dark\)\s*\{\s*:root \{([^}]*)\}/);

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [text, background, minimum]
const pairs = [
  ["text", "bg", 4.5], ["text", "surface", 4.5], ["muted", "surface", 4.5], ["muted", "bg", 4.5],
  ["accent", "surface", 4.5], ["accent-text", "accent", 4.5], ["error-text", "surface", 4.5],
  ["go-text", "go-bg", 4.5], ["tight-text", "tight-bg", 4.5], ["no-text", "no-bg", 4.5], ["unsure-text", "unsure-bg", 4.5],
  ["text", "flash", 4.5],
  ["surface", "no-text", 4.5], // "Yes, delete it" button
  ["text", "unsure-bg", 4.5], // highlighted option in the station list
  ["line", "surface", 1.2], // borders are decoration, every control also has text
  ["focus", "surface", 3], ["focus", "bg", 3], // focus ring: non-text, 3:1
];

let failed = 0;
for (const [name, theme] of [["light", light], ["dark", dark]]) {
  for (const [fg, bg, min] of pairs) {
    const r = ratio(theme[fg], theme[bg]);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`${ok ? "pass" : "FAIL"}  ${name.padEnd(5)} ${fg.padEnd(12)} on ${bg.padEnd(9)} ${r.toFixed(2)}:1 (needs ${min})`);
  }
}
process.exit(failed ? 1 : 0);
