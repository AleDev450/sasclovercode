/**
 * Types only.
 *
 * There is intentionally no re-export of the client factories here. A barrel
 * that pulled in `./server` would drag `server-only` into every client bundle
 * that touched Supabase. Import the factory you need explicitly:
 *
 *   import { createSupabaseBrowserClient } from "@/lib/supabase/client";
 *   import { createSupabaseServerClient }  from "@/lib/supabase/server";
 */
export type { CloverCodeSupabaseClient } from "./types";
