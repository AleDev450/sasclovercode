import Link from "next/link";
import { Badge, EmptyState, PageHeader, StatCard, StatGrid, buttonVariants } from "@/components/ui";
import {
  IconArrowRight,
  IconBuilding,
  IconCheckCircle,
  IconGlobe,
  IconUsers,
} from "@/components/ui/icons";
import { PRODUCT_NAME, SYSTEM_DOMAIN } from "@/config/app";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { listPlatformTenants, type PlatformTenant } from "@/modules/platform/server/queries";

export const metadata = { title: "Empresas" };

const STATUS_VARIANT = {
  active: "success",
  suspended: "warning",
  archived: "neutral",
} as const;

const STATUS_LABEL = {
  active: "Activa",
  suspended: "Suspendida",
  archived: "Archivada",
} as const;

/** The first letter, as a stand-in for the logo a business has not uploaded. */
function TenantAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="bg-accent text-accent-foreground flex size-11 shrink-0 items-center justify-center rounded-xl text-lg font-semibold"
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * One business, as a card.
 *
 * WHY NOT THE TABLE IT WAS. A table is the right shape for comparing a column
 * across many rows - which is a question nobody asks here. An operator opening
 * this screen is looking for ONE business, and then going into it; the table
 * made both halves worse, because a name competed for attention with four
 * cells beside it and the row was a link disguised as text.
 *
 * The whole card is the link, so the target is the size of the card rather than
 * the width of a name.
 */
function TenantCard({ tenant }: { tenant: PlatformTenant }) {
  return (
    <li>
      <Link
        href={`/super-admin/tenants/${tenant.id}`}
        className={cn(
          "bg-card text-card-foreground shadow-e1 group flex h-full flex-col gap-4 rounded-xl border p-5",
          "transition-[box-shadow,border-color,transform] duration-200",
          "hover:border-primary/30 hover:shadow-e2 hover:-translate-y-0.5",
        )}
      >
        <div className="flex items-start gap-3">
          <TenantAvatar name={tenant.name} />

          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-semibold tracking-tight">{tenant.name}</span>
            <span className="text-muted-foreground truncate font-mono text-xs">{tenant.slug}</span>
          </div>

          <Badge variant={STATUS_VARIANT[tenant.status]} dot className="shrink-0">
            {STATUS_LABEL[tenant.status]}
          </Badge>
        </div>

        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-center gap-2">
            <IconGlobe className="text-muted-foreground size-4 shrink-0" />
            <dt className="sr-only">Dominio principal</dt>
            <dd className="text-muted-foreground truncate">
              {tenant.primaryDomain ?? "Sin dominio"}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <IconUsers className="text-muted-foreground size-4 shrink-0" />
            <dt className="sr-only">Miembros</dt>
            <dd className="text-muted-foreground">
              {tenant.memberCount} miembro{tenant.memberCount === 1 ? "" : "s"}
            </dd>
          </div>
        </dl>

        <div className="border-border mt-auto flex items-center justify-between gap-2 border-t pt-3">
          <span className="text-muted-foreground text-xs">
            Desde {formatDate(tenant.createdAt)}
          </span>
          <span className="text-primary flex items-center gap-1 text-xs font-medium">
            Administrar
            <IconArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </Link>
    </li>
  );
}

export default async function PlatformTenantsPage() {
  const tenants = await listPlatformTenants();

  const active = tenants.filter((tenant) => tenant.status === "active").length;
  const suspended = tenants.filter((tenant) => tenant.status === "suspended").length;
  /*
   * A CUSTOM domain, which is not the same as having a primary one.
   *
   * Every tenant is issued `{slug}.clovercodeapp.com` at provisioning, so
   * counting `primaryDomain !== null` reported every business as having its own
   * domain - which made the tile read "3 con dominio propio / 0 usan el
   * subdominio del sistema" about three businesses that were all on the system
   * subdomain. What an operator wants to know is who has finished pointing
   * their own domain here, because that is the step that stalls.
   */
  const withCustomDomain = tenants.filter(
    (tenant) =>
      tenant.primaryDomain !== null && !tenant.primaryDomain.endsWith(`.${SYSTEM_DOMAIN}`),
  ).length;
  const members = tenants.reduce((sum, tenant) => sum + tenant.memberCount, 0);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Empresas"
        description={`Cada negocio que vende con ${PRODUCT_NAME}. Entra en uno para ver su plan, sus dominios y su cobranza.`}
        actions={
          <Link href="/super-admin/tenants/new" className={buttonVariants({ size: "md" })}>
            Crear empresa
          </Link>
        }
      />

      {tenants.length === 0 ? (
        <EmptyState
          title="Aun no hay empresas"
          description="Crea la primera para incorporarla a CloverCode."
          icon={<IconBuilding className="size-8" />}
          titleAs="h2"
          action={
            <Link href="/super-admin/tenants/new" className={buttonVariants()}>
              Crear empresa
            </Link>
          }
        />
      ) : (
        <>
          <StatGrid>
            <StatCard
              label="Empresas"
              value={tenants.length}
              hint={`${active} activa(s)`}
              icon={<IconBuilding />}
              tone="brand"
            />
            <StatCard
              label="Suspendidas"
              value={suspended}
              hint={suspended > 0 ? "No pueden vender hasta reactivarlas" : "Ninguna suspendida"}
              icon={<IconCheckCircle />}
              tone={suspended > 0 ? "warning" : "success"}
            />
            <StatCard
              label="Con dominio propio"
              value={withCustomDomain}
              hint={`${tenants.length - withCustomDomain} usan el subdominio del sistema`}
              icon={<IconGlobe />}
            />
            <StatCard
              label="Personas con acceso"
              value={members}
              hint="Sumando el equipo de todas las empresas"
              icon={<IconUsers />}
            />
          </StatGrid>

          <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {tenants.map((tenant) => (
              <TenantCard key={tenant.id} tenant={tenant} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
