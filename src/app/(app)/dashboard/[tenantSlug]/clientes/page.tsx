import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
} from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { DOC_TYPE_LABELS } from "@/modules/customers/documents";
import { CustomerForm } from "@/modules/customers/components/customer-form";
import { customerFiltersSchema } from "@/modules/customers/schemas";
import { listCustomers } from "@/modules/customers/server/queries";

export const metadata = { title: "Clientes" };

/**
 * The customer book.
 *
 * The filters live in the query string rather than in client state: a search
 * that can be shared, that survives a reload, and that a Server Component reads
 * without any JavaScript.
 */
export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // The nav hides this entry without the permission, but hiding is cosmetic
  // (master section 45): a typed URL lands here, so the page checks too.
  if (!(await hasPermission(tenant.id, PERMISSIONS.CUSTOMERS_VIEW))) {
    notFound();
  }

  const canManage = await hasPermission(tenant.id, PERMISSIONS.CUSTOMERS_MANAGE);

  const raw = await searchParams;
  const readParam = (key: string): string | undefined => {
    const value = raw[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const filters = customerFiltersSchema.parse({
    search: readParam("q"),
    includeInactive: readParam("inactivos"),
    page: readParam("page"),
  });

  const { customers, total, page, pageCount } = await listCustomers(tenant.id, filters);

  /** Keeps the current filters while changing one of them. */
  const hrefWith = (overrides: Record<string, string | null>): string => {
    const query = new URLSearchParams();
    if (filters.search !== null) query.set("q", filters.search);
    if (filters.includeInactive) query.set("inactivos", "1");
    if (page > 1) query.set("page", String(page));

    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) query.delete(key);
      else query.set(key, value);
    }

    const suffix = query.toString();
    return `/dashboard/${tenant.slug}/clientes${suffix.length > 0 ? `?${suffix}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
        <p className="text-muted-foreground text-sm">
          A quien le vende {tenant.name}. Solo se guarda lo que hace falta para atenderlos y
          facturarles.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {/* A GET form: the search ends up in the URL, where it belongs. */}
          <form method="get" className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-2">
              <label htmlFor="q" className="text-sm font-medium">
                Buscar
              </label>
              <Input
                id="q"
                name="q"
                defaultValue={filters.search ?? ""}
                placeholder="Nombre, documento, telefono o correo"
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                name="inactivos"
                value="1"
                defaultChecked={filters.includeInactive}
                className="size-4"
              />
              Incluir inactivos
            </label>
            <Button type="submit" variant="secondary">
              Buscar
            </Button>
          </form>
        </CardContent>
      </Card>

      {customers.length === 0 ? (
        <EmptyState
          title={filters.search !== null ? "Sin resultados" : "Aun no hay clientes"}
          description={
            filters.search !== null
              ? `Nadie coincide con "${filters.search}".`
              : "Los clientes se registran cuando piden comprobante o entrega a domicilio."
          }
          action={
            filters.search !== null ? (
              <Link href={hrefWith({ q: null, page: null })} className="text-sm hover:underline">
                Limpiar la busqueda
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse text-sm">
            <caption className="sr-only">Clientes de {tenant.name}</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="px-4 py-3 font-medium">
                  Cliente
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Documento
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Contacto
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Estado
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Accion
                </th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id} className="border-border border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{customer.name}</td>
                  <td className="text-muted-foreground px-4 py-3">
                    {customer.docType === null
                      ? "Sin documento"
                      : `${DOC_TYPE_LABELS[customer.docType]} ${customer.docNumber}`}
                  </td>
                  <td className="text-muted-foreground px-4 py-3">
                    {customer.phone ?? customer.email ?? "Sin contacto"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={customer.isActive ? "success" : "neutral"}>
                      {customer.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/${tenant.slug}/clientes/${customer.id}`}
                      className="text-sm hover:underline"
                    >
                      {canManage ? "Editar" : "Ver"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {pageCount > 1 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="Paginacion">
          <span className="text-muted-foreground">
            Pagina {page} de {pageCount} — {total} clientes
          </span>
          <span className="flex gap-4">
            {page > 1 ? (
              <Link href={hrefWith({ page: String(page - 1) })} className="hover:underline">
                Anterior
              </Link>
            ) : null}
            {page < pageCount ? (
              <Link href={hrefWith({ page: String(page + 1) })} className="hover:underline">
                Siguiente
              </Link>
            ) : null}
          </span>
        </nav>
      ) : null}

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Nuevo cliente</CardTitle>
            <CardDescription>
              Solo el nombre es obligatorio. El documento hace falta cuando piden boleta o factura.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CustomerForm tenantSlug={tenant.slug} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
