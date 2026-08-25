/**
 * Database type contract.
 *
 * Kept in sync with `supabase/migrations/` by hand, because generating types
 * (`supabase gen types typescript --local`) needs a running Supabase stack, and
 * therefore Docker, which CI does not have.
 *
 * That trade-off is only acceptable because the drift is caught automatically:
 * `src/tests/database/schema-contract.test.ts` introspects a real PostgreSQL
 * with the migrations applied and fails if this file and the schema disagree on
 * a column, a type, a nullability or an enum value.
 *
 * When a Supabase stack IS available, regenerate instead of hand-editing:
 *
 *   npx supabase gen types typescript --local > src/types/database.ts
 *
 * CLOVERCODE_MASTER.md section 14.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type TenantStatus = "active" | "suspended" | "archived";
export type TenantDomainType = "system" | "custom";
export type DomainVerificationStatus = "pending" | "verifying" | "active" | "failed";

export type Database = {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          status: TenantStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          status?: TenantStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          status?: TenantStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tenant_domains: {
        Row: {
          id: string;
          tenant_id: string;
          domain: string;
          type: TenantDomainType;
          is_primary: boolean;
          verification_status: DomainVerificationStatus;
          verified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          domain: string;
          type: TenantDomainType;
          is_primary?: boolean;
          verification_status?: DomainVerificationStatus;
          verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          domain?: string;
          type?: TenantDomainType;
          is_primary?: boolean;
          verification_status?: DomainVerificationStatus;
          verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_domains_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      resolve_tenant_by_domain: {
        Args: { p_hostname: string };
        Returns: {
          tenant_id: string;
          slug: string;
          name: string;
          status: TenantStatus;
          domain: string;
          domain_type: TenantDomainType;
          is_primary: boolean;
        }[];
      };
    };
    Enums: {
      tenant_status: TenantStatus;
      tenant_domain_type: TenantDomainType;
      domain_verification_status: DomainVerificationStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
