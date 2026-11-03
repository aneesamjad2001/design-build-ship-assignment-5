import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A Supabase client that sends the Clerk session token with every request, and to Realtime
 * on connect and on every heartbeat (so Clerk's short-lived tokens stay fresh). Supabase
 * trusts Clerk (third-party auth), so row-level security sees the token's `sub` as the
 * person. The URL and publishable key are public by design; RLS is what protects rows.
 */
export function createSupabase(getToken: () => Promise<string | null>): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase isn't configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local",
    );
  }
  return createClient(url, key, { accessToken: getToken });
}
