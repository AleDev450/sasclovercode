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

/** Master section 12. Order matches the enum's sort order in PostgreSQL. */
export type TenantRole =
  "owner" | "admin" | "manager" | "cashier" | "waiter" | "kitchen" | "delivery" | "accountant";

export type MembershipStatus = "active" | "invited" | "suspended";

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
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tenant_members: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          role: TenantRole;
          status: MembershipStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          role: TenantRole;
          status?: MembershipStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          role?: TenantRole;
          status?: MembershipStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenant_members_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      roles: {
        Row: {
          code: TenantRole;
          label: string;
          description: string | null;
          rank: number;
          created_at: string;
        };
        Insert: {
          code: TenantRole;
          label: string;
          description?: string | null;
          rank: number;
          created_at?: string;
        };
        Update: {
          code?: TenantRole;
          label?: string;
          description?: string | null;
          rank?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      permissions: {
        Row: {
          code: string;
          resource: string;
          action: string;
          description: string | null;
          created_at: string;
        };
        Insert: {
          code: string;
          resource: string;
          action: string;
          description?: string | null;
          created_at?: string;
        };
        Update: {
          code?: string;
          resource?: string;
          action?: string;
          description?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      role_permissions: {
        Row: {
          role: TenantRole;
          permission: string;
        };
        Insert: {
          role: TenantRole;
          permission: string;
        };
        Update: {
          role?: TenantRole;
          permission?: string;
        };
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_fkey";
            columns: ["role"];
            referencedRelation: "roles";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "role_permissions_permission_fkey";
            columns: ["permission"];
            referencedRelation: "permissions";
            referencedColumns: ["code"];
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
      get_my_memberships: {
        Args: Record<string, never>;
        Returns: {
          membership_id: string;
          tenant_id: string;
          tenant_slug: string;
          tenant_name: string;
          tenant_status: TenantStatus;
          role: TenantRole;
          status: MembershipStatus;
        }[];
      };
      is_tenant_member: {
        Args: { p_tenant_id: string };
        Returns: boolean;
      };
      has_permission: {
        Args: { p_tenant_id: string; p_permission: string };
        Returns: boolean;
      };
      my_permissions: {
        Args: { p_tenant_id: string };
        Returns: { permission: string }[];
      };
    };
    Enums: {
      tenant_status: TenantStatus;
      tenant_domain_type: TenantDomainType;
      domain_verification_status: DomainVerificationStatus;
      tenant_role: TenantRole;
      membership_status: MembershipStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
