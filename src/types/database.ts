/**
 * Database type contract.
 *
 * PLACEHOLDER - Phase 00 creates no tables (see docs/specs/phase-00-foundation.md
 * section 8). This file exists so that every Supabase client is generically
 * typed from day one, and so that swapping in the generated types does not
 * change a single call signature.
 *
 * From Phase 01 onward this file is REGENERATED, never hand-edited:
 *
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
 *
 * CLOVERCODE_MASTER.md section 14: types coming from the database must stay in
 * sync with the database.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
