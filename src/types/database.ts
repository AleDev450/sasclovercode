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
export type DomainProviderStatus = "unknown" | "requested" | "ready" | "error";

/** Master section 12. Order matches the enum's sort order in PostgreSQL. */
export type TenantRole =
  "owner" | "admin" | "manager" | "cashier" | "waiter" | "kitchen" | "delivery" | "accountant";

export type MembershipStatus = "active" | "invited" | "suspended";
export type PlatformAdminStatus = "active" | "revoked";
export type PageStatus = "draft" | "published";
export type SectionTypeName =
  "hero" | "text" | "image" | "banner" | "cta" | "gallery" | "products" | "faq";
export type NavLinkType = "page" | "external";
export type SocialPlatform = "facebook" | "instagram" | "tiktok" | "x" | "youtube" | "linkedin";
export type ProductStatus = "draft" | "active" | "archived";

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
          /** Phase 09. Null on a system domain, which needs no proof. */
          verification_token: string | null;
          verification_checked_at: string | null;
          last_error: string | null;
          provider_status: DomainProviderStatus;
          provider_synced_at: string | null;
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
          verification_token?: string | null;
          verification_checked_at?: string | null;
          last_error?: string | null;
          provider_status?: DomainProviderStatus;
          provider_synced_at?: string | null;
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
          verification_token?: string | null;
          verification_checked_at?: string | null;
          last_error?: string | null;
          provider_status?: DomainProviderStatus;
          provider_synced_at?: string | null;
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
      platform_admins: {
        Row: {
          user_id: string;
          status: PlatformAdminStatus;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          status?: PlatformAdminStatus;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          status?: PlatformAdminStatus;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_admins_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      pages: {
        Row: {
          id: string;
          tenant_id: string;
          slug: string;
          title: string;
          status: PageStatus;
          /** Phase 08. Null means "inherit from the site", never "blank". */
          seo_title: string | null;
          seo_description: string | null;
          og_image_path: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          slug: string;
          title: string;
          status?: PageStatus;
          seo_title?: string | null;
          seo_description?: string | null;
          og_image_path?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["pages"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "pages_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      page_sections: {
        Row: {
          id: string;
          page_id: string;
          tenant_id: string;
          type: SectionTypeName;
          content: Json;
          position: number;
          is_visible: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          page_id: string;
          tenant_id: string;
          type: SectionTypeName;
          content?: Json;
          position?: number;
          is_visible?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["page_sections"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "page_sections_page_id_fkey";
            columns: ["page_id"];
            referencedRelation: "pages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "page_sections_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      navigation_items: {
        Row: {
          id: string;
          tenant_id: string;
          parent_id: string | null;
          label: string;
          link_type: NavLinkType;
          page_id: string | null;
          external_url: string | null;
          position: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          parent_id?: string | null;
          label: string;
          link_type: NavLinkType;
          page_id?: string | null;
          external_url?: string | null;
          position?: number;
          is_active?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["navigation_items"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "navigation_items_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "navigation_items_parent_id_fkey";
            columns: ["parent_id"];
            referencedRelation: "navigation_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "navigation_items_page_id_fkey";
            columns: ["page_id"];
            referencedRelation: "pages";
            referencedColumns: ["id"];
          },
        ];
      };
      tenant_settings: {
        Row: {
          tenant_id: string;
          legal_name: string | null;
          trade_name: string | null;
          tax_id: string | null;
          contact_email: string | null;
          phone: string | null;
          whatsapp: string | null;
          address_line: string | null;
          district: string | null;
          city: string | null;
          currency: string;
          timezone: string;
          created_at: string;
          updated_at: string;
        };
        Insert: { tenant_id: string } & Partial<
          Omit<Database["public"]["Tables"]["tenant_settings"]["Row"], "tenant_id">
        >;
        Update: Partial<Database["public"]["Tables"]["tenant_settings"]["Row"]>;
        Relationships: [];
      };
      tenant_themes: {
        Row: {
          tenant_id: string;
          primary_color: string;
          accent_color: string;
          background_color: string;
          font_family: string;
          border_radius: string;
          logo_path: string | null;
          favicon_path: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: { tenant_id: string } & Partial<
          Omit<Database["public"]["Tables"]["tenant_themes"]["Row"], "tenant_id">
        >;
        Update: Partial<Database["public"]["Tables"]["tenant_themes"]["Row"]>;
        Relationships: [];
      };
      tenant_seo: {
        Row: {
          tenant_id: string;
          site_title: string | null;
          site_description: string | null;
          og_title: string | null;
          og_description: string | null;
          og_image_path: string | null;
          twitter_image_path: string | null;
          robots_index: boolean;
          google_verification: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: { tenant_id: string } & Partial<
          Omit<Database["public"]["Tables"]["tenant_seo"]["Row"], "tenant_id">
        >;
        Update: Partial<Database["public"]["Tables"]["tenant_seo"]["Row"]>;
        Relationships: [];
      };
      locations: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          address_line: string | null;
          district: string | null;
          city: string | null;
          reference: string | null;
          phone: string | null;
          /** Stored as numeric; PostgREST returns it as a JS number. */
          latitude: number | null;
          longitude: number | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: { tenant_id: string; name: string } & Partial<
          Omit<Database["public"]["Tables"]["locations"]["Row"], "tenant_id" | "name">
        >;
        Update: Partial<Database["public"]["Tables"]["locations"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "locations_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      location_hours: {
        Row: {
          id: string;
          location_id: string;
          tenant_id: string;
          /** 0 = Sunday, matching getDay() and PostgreSQL dow. */
          day_of_week: number;
          /** `time`, as HH:MM:SS. Local business time, never UTC. */
          opens_at: string;
          closes_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          location_id: string;
          /** Derived by a trigger from the location; never trusted from a client. */
          tenant_id?: string;
          day_of_week: number;
          opens_at: string;
          closes_at: string;
        };
        Update: Partial<Database["public"]["Tables"]["location_hours"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "location_hours_location_id_fkey";
            columns: ["location_id"];
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          slug: string;
          description: string | null;
          position: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: { tenant_id: string; name: string; slug: string } & Partial<
          Omit<Database["public"]["Tables"]["categories"]["Row"], "tenant_id" | "name" | "slug">
        >;
        Update: Partial<Database["public"]["Tables"]["categories"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "categories_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          id: string;
          tenant_id: string;
          category_id: string | null;
          name: string;
          slug: string;
          description: string | null;
          /** Minor units. 2490 is S/ 24.90. Never a float (ADR-015). */
          base_price_cents: number;
          status: ProductStatus;
          /** Available today. Independent of `status`, which is editorial. */
          is_available: boolean;
          is_featured: boolean;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: { tenant_id: string; name: string; slug: string } & Partial<
          Omit<Database["public"]["Tables"]["products"]["Row"], "tenant_id" | "name" | "slug">
        >;
        Update: Partial<Database["public"]["Tables"]["products"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      product_images: {
        Row: {
          id: string;
          product_id: string;
          tenant_id: string;
          path: string;
          alt_text: string | null;
          position: number;
          is_primary: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          /** Derived by a trigger from the product; never trusted from a client. */
          tenant_id?: string;
          path: string;
          alt_text?: string | null;
          position?: number;
          is_primary?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["product_images"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey";
            columns: ["product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_variants: {
        Row: {
          id: string;
          product_id: string;
          tenant_id: string;
          name: string;
          sku: string | null;
          /** Absolute price in minor units, not a delta on the product. */
          price_cents: number;
          is_active: boolean;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          tenant_id?: string;
          name: string;
          sku?: string | null;
          price_cents?: number;
          is_active?: boolean;
          position?: number;
        };
        Update: Partial<Database["public"]["Tables"]["product_variants"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey";
            columns: ["product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_options: {
        Row: {
          id: string;
          product_id: string;
          tenant_id: string;
          group_label: string;
          name: string;
          /** Signed: an option may subtract as well as add. */
          price_delta_cents: number;
          is_active: boolean;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          tenant_id?: string;
          group_label: string;
          name: string;
          price_delta_cents?: number;
          is_active?: boolean;
          position?: number;
        };
        Update: Partial<Database["public"]["Tables"]["product_options"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "product_options_product_id_fkey";
            columns: ["product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      tenant_social_links: {
        Row: {
          id: string;
          tenant_id: string;
          platform: SocialPlatform;
          url: string;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          platform: SocialPlatform;
          url: string;
          position?: number;
        };
        Update: Partial<Database["public"]["Tables"]["tenant_social_links"]["Row"]>;
        Relationships: [];
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
      storage_path_tenant_id: {
        Args: { p_name: string };
        Returns: string | null;
      };
      storage_path_folder: {
        Args: { p_name: string };
        Returns: string | null;
      };
      get_public_business_identity: {
        Args: { p_tenant_id: string };
        Returns: {
          trade_name: string | null;
          address_line: string | null;
          district: string | null;
          city: string | null;
          phone: string | null;
          currency: string;
        }[];
      };
      get_tenant_primary_domain: {
        Args: { p_tenant_id: string };
        Returns: string | null;
      };
      claim_domain: {
        Args: { p_tenant_id: string; p_domain: string };
        Returns: string;
      };
      record_domain_ownership_check: {
        Args: { p_domain_id: string; p_ok: boolean; p_error?: string | null };
        Returns: DomainVerificationStatus;
      };
      set_primary_domain: {
        Args: { p_domain_id: string };
        Returns: undefined;
      };
      is_tenant_public: {
        Args: { p_tenant_id: string };
        Returns: boolean;
      };
      is_platform_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      provision_tenant: {
        Args: { p_name: string; p_slug: string; p_owner_email: string };
        Returns: string;
      };
      list_platform_tenants: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          name: string;
          slug: string;
          status: TenantStatus;
          primary_domain: string | null;
          member_count: number;
          created_at: string;
        }[];
      };
      get_tenant_members: {
        Args: { p_tenant_id: string };
        Returns: {
          membership_id: string;
          user_id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          role: TenantRole;
          status: MembershipStatus;
          created_at: string;
        }[];
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
      domain_provider_status: DomainProviderStatus;
      tenant_role: TenantRole;
      membership_status: MembershipStatus;
      platform_admin_status: PlatformAdminStatus;
      social_platform: SocialPlatform;
      product_status: ProductStatus;
      page_status: PageStatus;
      section_type: SectionTypeName;
      nav_link_type: NavLinkType;
    };
    CompositeTypes: Record<string, never>;
  };
};
