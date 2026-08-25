import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * The only Supabase client type used across CloverCode.
 *
 * Both the browser and the server factories return this, so business code can
 * accept a client without caring where it came from.
 */
export type CloverCodeSupabaseClient = SupabaseClient<Database>;
