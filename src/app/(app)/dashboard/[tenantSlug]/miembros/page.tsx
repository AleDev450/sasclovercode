import { notFound } from "next/navigation";
import { Badge, Card, EmptyState } from "@/components/ui";
import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant/active";

export const metadata = { title: "Miembros" };

const ROLE_LABEL: Record<string, string> = {
  owner: "Propietario",
  admin: "Administrador",
  manager: "Encargado",
  cashier: "Cajero",
  waiter: "Mesero",
  kitchen: "Cocina",
  delivery: "Repartidor",
  accountant: "Contador",
};

const STATUS_VARIANT = {
  active: "success",
  invited: "neutral",
  suspended: "warning",
} as const;

export default async function MembersPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // The nav entry is hidden without this permission, but hiding is cosmetic
  // (master section 45). A typed URL lands here, so the page checks too - and
  // answers 404, not 403, to avoid confirming the section exists.
  if (!(await hasPermission(tenant.id, PERMISSIONS.MEMBERS_VIEW))) {
    notFound();
  }

  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("get_tenant_members", { p_tenant_id: tenant.id });

  if (error) {
    logger.error("dashboard.members.list_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Member listing failed.", { cause: error });
  }

  const members = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Miembros</h1>
        <p className="text-muted-foreground text-sm">Personas con acceso a {tenant.name}.</p>
      </div>

      {members.length === 0 ? (
        <EmptyState
          title="Aun no hay miembros"
          description="Cuando se asignen personas a esta empresa, apareceran aqui."
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <caption className="sr-only">Miembros de {tenant.name}</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="px-4 py-3 font-medium">
                  Persona
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Rol
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.membership_id} className="border-border border-b last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    {member.full_name ?? "Sin nombre"}
                    <span className="text-muted-foreground block text-xs font-normal">
                      {member.email}
                    </span>
                  </th>
                  <td className="px-4 py-3">{ROLE_LABEL[member.role] ?? member.role}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[member.status]}>
                      {member.status === "active"
                        ? "Activo"
                        : member.status === "invited"
                          ? "Invitado"
                          : "Suspendido"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
