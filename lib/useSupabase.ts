"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabase } from "./supabase";

/** One Supabase client per page, always asking Clerk for the current token. */
export function useSupabase(): SupabaseClient | null {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const tokenRef = useRef(getToken);
  const [client, setClient] = useState<SupabaseClient | null>(null);

  useEffect(() => {
    tokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const c = createSupabase(() => tokenRef.current());
    setClient(c);
    return () => {
      c.removeAllChannels();
    };
  }, [isLoaded, isSignedIn]);

  return client;
}
