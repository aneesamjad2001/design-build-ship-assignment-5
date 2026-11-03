// poll-divvy: Supabase Cron calls this every 10 s. It reads Divvy's station_status,
// hands every station to public.apply_station_status (which writes only real changes),
// and records the run in public.worker_runs, ok or not.
//
// Deployed with verify_jwt = false: the caller proves itself with x-worker-secret,
// a random value generated inside the database (Vault). Writes use the secret key
// that Supabase injects into this function's environment; no key is in this code.

import { runOnce } from "./run.ts";
import type { ApplyResult, Deps, RunRecord } from "./run.ts";
import type { InfoRow, StatusRow } from "./divvy.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const DIVVY_TIMEOUT_MS = 8_000;
const DB_TIMEOUT_MS = 8_000;

/** The project's secret key: the new `default` secret key, else the legacy service_role key. */
function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const k = JSON.parse(keys)?.default;
      if (typeof k === "string" && k) return k;
    } catch { /* fall through to the legacy key */ }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  throw new Error("No Supabase secret key in the function environment");
}

const KEY = secretKey();
// New keys (sb_secret_…) go on apikey only; legacy JWT keys also need Authorization.
const DB_HEADERS: Record<string, string> = {
  apikey: KEY,
  "Content-Type": "application/json",
  ...(KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${KEY}` }),
};

async function db(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...DB_HEADERS, ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(DB_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Database ${path.split("?")[0]}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const rpc = (name: string, args: unknown) =>
  db(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });

async function latest<T>(select: string, filter = ""): Promise<T | null> {
  const rows = (await db(`worker_runs?select=${select}${filter ? `&${filter}` : ""}&order=ran_at.desc&limit=1`)) as T[];
  return rows[0] ?? null;
}

async function fetchJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Dockcheck/1.0 (class project; polls every 10 s)" },
      signal: AbortSignal.timeout(DIVVY_TIMEOUT_MS),
    });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error(`Divvy didn't answer within ${DIVVY_TIMEOUT_MS / 1000} s`);
    }
    throw new Error(`Couldn't reach Divvy: ${(e as Error)?.message ?? e}`);
  }
  if (!res.ok) throw new Error(`Divvy returned HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Error("Divvy sent something that isn't JSON");
  }
}

const deps: Deps = {
  fetchJson,
  lastRun: () => latest<{ ok: boolean; feed_updated_at: string | null }>("ok,feed_updated_at"),
  lastInfoRefreshAt: async () =>
    (await latest<{ ran_at: string }>("ran_at", "info_changed=not.is.null"))?.ran_at ?? null,
  applyStatus: async (rows: StatusRow[], feedUpdatedAt: string) =>
    (await rpc("apply_station_status", { p_rows: rows, p_feed_updated_at: feedUpdatedAt })) as ApplyResult,
  applyInformation: async (rows: InfoRow[]) =>
    (await rpc("apply_station_information", { p_rows: rows })) as number,
  recordRun: async (run: RunRecord) => {
    await db("worker_runs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(run) });
  },
  now: () => Date.now(),
};

// The expected worker secret, cached per warm instance and re-read once on a mismatch
// (so rotating it in Vault doesn't lock out the cron job until instances recycle).
let expectedSecret: string | null = null;
const readSecret = async () => (expectedSecret = (await rpc("dockcheck_worker_secret", {})) as string);

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const given = req.headers.get("x-worker-secret") ?? "";
  let authorized = false;
  try {
    const wasCached = expectedSecret !== null;
    authorized = sameSecret(given, expectedSecret ?? (await readSecret()));
    if (!authorized && wasCached && given) authorized = sameSecret(given, await readSecret());
  } catch (e) {
    console.error("Couldn't read the worker secret:", (e as Error).message);
    return new Response("Worker misconfigured", { status: 500 });
  }

  if (!authorized) {
    // Not recorded as a run: a stranger's request is not our worker failing.
    console.warn("Rejected a call without the worker secret");
    return new Response("Unauthorized", { status: 401 });
  }

  let refreshInfo = false;
  try {
    const body = await req.json();
    refreshInfo = body?.refresh_info === true;
  } catch { /* empty body is fine */ }

  try {
    const run = await runOnce(deps, { refreshInfo });
    if (!run.ok) console.error("Run failed:", run.error);
    return Response.json(run, { status: run.ok ? 200 : 502 });
  } catch (e) {
    // Only reached if recording the run itself failed (database unreachable).
    console.error("Couldn't record the run:", (e as Error).message);
    return new Response("Couldn't record the run", { status: 500 });
  }
});
