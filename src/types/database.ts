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

/** Master section 33 (Phase 12): the three Peruvian documents, no more. */
export type CustomerDocType = "dni" | "ruc" | "ce";

/** Master section 33 (Phase 13). Order matches the enum's sort order. */
export type OrderStatus =
  "pending" | "confirmed" | "preparing" | "ready" | "completed" | "cancelled";
export type OrderSource = "web" | "pos" | "manual" | "whatsapp" | "delivery";

/** Master section 14 (Phase 14). */
export type PaymentMethodType = "cash" | "yape" | "plin" | "card" | "transfer" | "other";
export type CashMovementType = "sale" | "payout" | "deposit" | "adjustment";

/** Master section 33 (Phase 16). Snapshotted onto order_items at insert (ADR-020). */
export type KitchenStation = "kitchen" | "bar" | "sushi" | "desserts";

/** Master section 33 (Phase 17). */
export type BillingDocumentType = "boleta" | "factura" | "nota_credito" | "nota_debito";
export type BillingDocumentStatus = "pending" | "sent" | "accepted" | "rejected" | "cancelled";

/** Master section 33 (Phase 18). */
export type StockMovementType = "purchase" | "sale" | "adjustment" | "waste" | "return" | "transfer";

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
          /** Which kitchen screen this category's items show up on (Phase 16). */
          kitchen_station: KitchenStation;
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
      customers: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          doc_type: CustomerDocType | null;
          doc_number: string | null;
          email: string | null;
          phone: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: { tenant_id: string; name: string } & Partial<
          Omit<Database["public"]["Tables"]["customers"]["Row"], "tenant_id" | "name">
        >;
        Update: Partial<Database["public"]["Tables"]["customers"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_addresses: {
        Row: {
          id: string;
          customer_id: string;
          tenant_id: string;
          label: string;
          address_line: string;
          district: string | null;
          city: string | null;
          reference: string | null;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          /** Derived by a trigger from the customer; never trusted from a client. */
          tenant_id?: string;
          label: string;
          address_line: string;
          district?: string | null;
          city?: string | null;
          reference?: string | null;
          is_default?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["customer_addresses"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_id_fkey";
            columns: ["customer_id"];
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_addresses_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          id: string;
          tenant_id: string;
          location_id: string;
          customer_id: string | null;
          number: number;
          status: OrderStatus;
          source: OrderSource;
          notes: string | null;
          subtotal_cents: number;
          discount_cents: number;
          tax_cents: number;
          shipping_cents: number;
          total_cents: number;
          /** Sum of non-voided payments (Phase 14). Computed by trigger; never sent by a client. */
          paid_cents: number;
          placed_at: string;
          completed_at: string | null;
          cancelled_at: string | null;
          cancel_reason: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: { tenant_id: string; location_id: string } & Partial<
          Omit<Database["public"]["Tables"]["orders"]["Row"], "tenant_id" | "location_id">
        >;
        Update: Partial<Database["public"]["Tables"]["orders"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "orders_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_location_id_fkey";
            columns: ["location_id"];
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_customer_id_fkey";
            columns: ["customer_id"];
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          tenant_id: string;
          product_id: string | null;
          variant_id: string | null;
          name_snapshot: string;
          variant_snapshot: string | null;
          unit_price_cents: number;
          /** numeric(10,3): a quantity, never money. ADR-015 is untouched. */
          quantity: number;
          discount_cents: number;
          tax_cents: number;
          total_cents: number;
          notes: string | null;
          position: number;
          /** Snapshotted from the product's category at insert (Phase 16, ADR-020). */
          station: KitchenStation;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          /** Derived by a trigger from the order; never trusted from a client. */
          tenant_id?: string;
          product_id?: string | null;
          variant_id?: string | null;
          /** Copied from the catalogue by a trigger when product_id is given. */
          name_snapshot?: string;
          variant_snapshot?: string | null;
          /** Never sent by a client for a catalogue line: the trigger sets it. */
          unit_price_cents?: number;
          quantity: number;
          discount_cents?: number;
          tax_cents?: number;
          notes?: string | null;
          position?: number;
          /** Never sent by a client: the trigger copies it from the category. */
          station?: KitchenStation;
        };
        Update: Partial<Database["public"]["Tables"]["order_items"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      order_status_history: {
        Row: {
          id: string;
          order_id: string;
          tenant_id: string;
          from_status: OrderStatus | null;
          to_status: OrderStatus;
          reason: string | null;
          changed_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          tenant_id?: string;
          from_status?: OrderStatus | null;
          to_status: OrderStatus;
          reason?: string | null;
          changed_by?: string | null;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "order_status_history_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      order_transitions: {
        Row: {
          from_status: OrderStatus;
          to_status: OrderStatus;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      billing_documents: {
        Row: {
          id: string;
          /** Derived by a trigger from the order; never trusted from a client. */
          tenant_id: string;
          order_id: string;
          customer_id: string | null;
          type: BillingDocumentType;
          status: BillingDocumentStatus;
          /** Assigned by trigger from billing_provider_configs; never sent by a client. */
          series: string;
          number: number;
          idempotency_key: string;
          issuer_ruc_snapshot: string;
          customer_name_snapshot: string | null;
          customer_doc_type_snapshot: CustomerDocType | null;
          customer_doc_number_snapshot: string | null;
          subtotal_cents: number;
          tax_cents: number;
          total_cents: number;
          related_document_id: string | null;
          rejection_reason: string | null;
          cancel_reason: string | null;
          sent_at: string | null;
          accepted_at: string | null;
          rejected_at: string | null;
          cancelled_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          order_id: string;
          customer_id?: string | null;
          type: BillingDocumentType;
          status?: BillingDocumentStatus;
          related_document_id?: string | null;
          created_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["billing_documents"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "billing_documents_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_documents_customer_id_fkey";
            columns: ["customer_id"];
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_documents_related_document_id_fkey";
            columns: ["related_document_id"];
            referencedRelation: "billing_documents";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_document_transitions: {
        Row: {
          from_status: BillingDocumentStatus;
          to_status: BillingDocumentStatus;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      billing_document_items: {
        Row: {
          id: string;
          billing_document_id: string;
          tenant_id: string;
          order_item_id: string | null;
          description_snapshot: string;
          /** numeric(10,3): a quantity, never money. ADR-015 is untouched. */
          quantity: number;
          unit_price_cents: number;
          discount_cents: number;
          total_cents: number;
          subtotal_cents: number;
          tax_cents: number;
          position: number;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "billing_document_items_document_id_fkey";
            columns: ["billing_document_id"];
            referencedRelation: "billing_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_document_items_order_item_id_fkey";
            columns: ["order_item_id"];
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_events: {
        Row: {
          id: string;
          billing_document_id: string;
          tenant_id: string;
          from_status: BillingDocumentStatus | null;
          to_status: BillingDocumentStatus;
          message: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "billing_events_document_id_fkey";
            columns: ["billing_document_id"];
            referencedRelation: "billing_documents";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_provider_configs: {
        Row: {
          tenant_id: string;
          provider_name: string;
          is_active: boolean;
          series_boleta: string | null;
          series_factura: string | null;
          series_nota_credito: string | null;
          series_nota_debito: string | null;
          /** A Supabase Vault secret id. No function reads the credential back (ADR-021). */
          credentials_secret_id: string | null;
          credentials_updated_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          provider_name?: string;
          is_active?: boolean;
          series_boleta?: string | null;
          series_factura?: string | null;
          series_nota_credito?: string | null;
          series_nota_debito?: string | null;
        };
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["billing_provider_configs"]["Row"],
            "credentials_secret_id" | "credentials_updated_at"
          >
        >;
        Relationships: [
          {
            foreignKeyName: "billing_provider_configs_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      units: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          abbreviation: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          abbreviation: string;
          is_active?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["units"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "units_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_items: {
        Row: {
          id: string;
          tenant_id: string;
          unit_id: string;
          name: string;
          sku: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          unit_id: string;
          name: string;
          sku?: string | null;
          is_active?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["inventory_items"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "inventory_items_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_items_unit_id_fkey";
            columns: ["unit_id"];
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
        ];
      };
      suppliers: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          tax_id: string | null;
          contact_name: string | null;
          phone: string | null;
          email: string | null;
          address: string | null;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          tax_id?: string | null;
          contact_name?: string | null;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          notes?: string | null;
          is_active?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["suppliers"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "suppliers_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      purchases: {
        Row: {
          id: string;
          tenant_id: string;
          supplier_id: string;
          location_id: string;
          reference: string | null;
          purchased_at: string;
          notes: string | null;
          /** Summed by trigger from this purchase's own stock_movements. Never sent by a client. */
          total_cost_cents: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          supplier_id: string;
          location_id: string;
          reference?: string | null;
          purchased_at?: string;
          notes?: string | null;
          created_by?: string | null;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "purchases_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchases_supplier_id_fkey";
            columns: ["supplier_id"];
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchases_location_id_fkey";
            columns: ["location_id"];
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_movements: {
        Row: {
          id: string;
          /** Derived by a trigger from the inventory item; never trusted from a client. */
          tenant_id: string;
          inventory_item_id: string;
          location_id: string;
          type: StockMovementType;
          /** Signed: stock in is positive, stock out is negative. */
          quantity: number;
          /** Set only for type=purchase. */
          unit_cost_cents: number | null;
          purchase_id: string | null;
          /** Set only for type=sale, written exclusively by the order-completion trigger. */
          order_id: string | null;
          order_item_id: string | null;
          /** Set only for type=transfer; the two rows of one transfer share this id. */
          transfer_group_id: string | null;
          reason: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          inventory_item_id: string;
          location_id: string;
          type: StockMovementType;
          quantity: number;
          unit_cost_cents?: number | null;
          purchase_id?: string | null;
          order_id?: string | null;
          order_item_id?: string | null;
          transfer_group_id?: string | null;
          reason?: string | null;
          created_by?: string | null;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "stock_movements_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_location_id_fkey";
            columns: ["location_id"];
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_purchase_id_fkey";
            columns: ["purchase_id"];
            referencedRelation: "purchases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_order_item_id_fkey";
            columns: ["order_item_id"];
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ];
      };
      recipes: {
        Row: {
          id: string;
          /** Derived by a trigger from the product; never trusted from a client. */
          tenant_id: string;
          product_id: string;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          product_id: string;
          notes?: string | null;
          is_active?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["recipes"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "recipes_product_id_fkey";
            columns: ["product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      recipe_items: {
        Row: {
          id: string;
          recipe_id: string;
          /** Derived by a trigger from the recipe; never trusted from a client. */
          tenant_id: string;
          inventory_item_id: string;
          /** Always in inventory_item_id's own unit - no conversion (ADR-022). */
          quantity: number;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          recipe_id: string;
          tenant_id?: string;
          inventory_item_id: string;
          quantity: number;
          position?: number;
        };
        Update: Partial<Database["public"]["Tables"]["recipe_items"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "recipe_items_recipe_id_fkey";
            columns: ["recipe_id"];
            referencedRelation: "recipes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recipe_items_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_methods: {
        Row: {
          id: string;
          tenant_id: string;
          type: PaymentMethodType;
          name: string;
          reference: string | null;
          is_active: boolean;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          type: PaymentMethodType;
          name: string;
          reference?: string | null;
          is_active?: boolean;
          position?: number;
        };
        Update: Partial<Database["public"]["Tables"]["payment_methods"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "payment_methods_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      cash_registers: {
        Row: {
          id: string;
          tenant_id: string;
          location_id: string;
          name: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          location_id: string;
          name: string;
          is_active?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["cash_registers"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "cash_registers_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_registers_location_id_fkey";
            columns: ["location_id"];
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };
      cash_sessions: {
        Row: {
          id: string;
          /** Derived by a trigger from the register; never trusted from a client. */
          tenant_id: string;
          cash_register_id: string;
          opened_by: string | null;
          closed_by: string | null;
          opening_cents: number;
          /** NULL until the session closes, together with the next two columns. */
          closing_cents: number | null;
          /** Computed by trigger at close: opening + the session's ledger. */
          expected_cents: number | null;
          difference_cents: number | null;
          notes: string | null;
          opened_at: string;
          closed_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          cash_register_id: string;
          opened_by?: string | null;
          opening_cents?: number;
          notes?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["cash_sessions"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "cash_sessions_register_id_fkey";
            columns: ["cash_register_id"];
            referencedRelation: "cash_registers";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          id: string;
          /** Derived by a trigger from the order; never trusted from a client. */
          tenant_id: string;
          order_id: string;
          payment_method_id: string;
          /** NOT NULL only for a `cash` payment, and must be an open session. */
          cash_session_id: string | null;
          amount_cents: number;
          reference: string | null;
          notes: string | null;
          voided_at: string | null;
          void_reason: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          order_id: string;
          payment_method_id: string;
          cash_session_id?: string | null;
          amount_cents: number;
          reference?: string | null;
          notes?: string | null;
          created_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["payments"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_payment_method_id_fkey";
            columns: ["payment_method_id"];
            referencedRelation: "payment_methods";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_cash_session_id_fkey";
            columns: ["cash_session_id"];
            referencedRelation: "cash_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      cash_movements: {
        Row: {
          id: string;
          /** Derived by a trigger from the session; never trusted from a client. */
          tenant_id: string;
          cash_session_id: string;
          type: CashMovementType;
          /** Signed: cash in is positive, cash out is negative. */
          amount_cents: number;
          /** Set for `sale` and a void's compensating `adjustment`; null for a manual entry. */
          payment_id: string | null;
          reason: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          cash_session_id: string;
          type: CashMovementType;
          amount_cents: number;
          payment_id?: string | null;
          reason?: string | null;
          created_by?: string | null;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "cash_movements_session_id_fkey";
            columns: ["cash_session_id"];
            referencedRelation: "cash_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_movements_payment_id_fkey";
            columns: ["payment_id"];
            referencedRelation: "payments";
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
    Views: {
      /** Current stock per item per location, summed live from stock_movements. Never a stored value (ADR-022). */
      inventory_stock_levels: {
        Row: {
          tenant_id: string;
          inventory_item_id: string;
          location_id: string;
          quantity_on_hand: number;
        };
        Relationships: [];
      };
    };
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
      is_valid_ruc: {
        Args: { p_value: string };
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
      set_billing_credentials: {
        Args: { p_tenant_id: string; p_credentials: string };
        Returns: undefined;
      };
      has_billing_credentials: {
        Args: { p_tenant_id: string };
        Returns: boolean;
      };
      clear_billing_credentials: {
        Args: { p_tenant_id: string };
        Returns: undefined;
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
      customer_doc_type: CustomerDocType;
      order_status: OrderStatus;
      order_source: OrderSource;
      payment_method_type: PaymentMethodType;
      cash_movement_type: CashMovementType;
      kitchen_station: KitchenStation;
      billing_document_type: BillingDocumentType;
      billing_document_status: BillingDocumentStatus;
      stock_movement_type: StockMovementType;
      page_status: PageStatus;
      section_type: SectionTypeName;
      nav_link_type: NavLinkType;
    };
    CompositeTypes: Record<string, never>;
  };
};
