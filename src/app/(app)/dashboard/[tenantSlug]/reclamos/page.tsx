import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { ComplaintAnswerForm } from "@/modules/legal/components/admin-forms";
import { listComplaints } from "@/modules/legal/server/queries";

export const metadata = { title: "Libro de reclamaciones" };

const FILTERS = [
  { value: "pending", label: "Pendientes" },
  { value: "answered", label: "Respondidas" },
  { value: "all", label: "Todas" },
] as const;

type Filter = (typeof FILTERS)[number]["value"];

function formatDate(value: string, withTime = false): string {
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: withTime ? "short" : undefined,
    timeZone: withTime ? "America/Lima" : "UTC",
  }).format(new Date(withTime ? value : `${value}T00:00:00Z`));
}

/**
 * The Libro de Reclamaciones, as the business reads it (Phase 30).
 *
 * No module gate: keeping the book is an obligation of every business that
 * sells to consumers, and paywalling a legal record would be charging for
 * compliance. The permission decides who reads it; the database decides that
 * what the consumer wrote can never change.
 */
export default async function ComplaintsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ estado?: string }>;
}) {
  const { tenantSlug } = await params;
  const { estado } = await searchParams;
  const tenant = await requireActiveTenant(tenantSlug);

  if (!(await hasPermission(tenant.id, PERMISSIONS.COMPLAINTS_VIEW))) notFound();

  const filter: Filter = FILTERS.some((option) => option.value === estado)
    ? (estado as Filter)
    : "pending";

  const [complaints, canAnswer] = await Promise.all([
    listComplaints(tenant.id, filter),
    hasPermission(tenant.id, PERMISSIONS.COMPLAINTS_MANAGE),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Libro de reclamaciones</h1>
        <p className="text-muted-foreground text-sm">
          Las hojas registradas desde tu web. Tienes 15 dias habiles para responder cada una, por el
          medio que eligio el consumidor.
        </p>
      </div>

      <nav aria-label="Filtrar hojas" className="flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <Link
            key={option.value}
            href={`/dashboard/${tenant.slug}/reclamos?estado=${option.value}`}
            aria-current={option.value === filter ? "page" : undefined}
            className={
              option.value === filter
                ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium"
                : "border-border text-muted-foreground hover:text-foreground rounded-md border px-3 py-1.5 text-sm"
            }
          >
            {option.label}
          </Link>
        ))}
      </nav>

      {complaints.length === 0 ? (
        <EmptyState
          title={filter === "pending" ? "No hay reclamos pendientes" : "No hay hojas registradas"}
          description="Cuando un cliente registre un reclamo o una queja en tu web, aparecera aqui."
        />
      ) : (
        complaints.map((complaint) => {
          const overdue = complaint.status === "pending" && complaint.dueOn < today;
          return (
            <Card key={complaint.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-3">
                  <CardTitle as="h2">Hoja N° {String(complaint.number).padStart(6, "0")}</CardTitle>
                  <Badge variant="neutral">
                    {complaint.type === "reclamo" ? "Reclamo" : "Queja"}
                  </Badge>
                  {complaint.status === "answered" ? (
                    <Badge variant="success">Respondida</Badge>
                  ) : overdue ? (
                    <Badge variant="destructive">Vencida</Badge>
                  ) : (
                    <Badge variant="warning">Pendiente</Badge>
                  )}
                </div>
                <CardDescription>
                  Registrada el {formatDate(complaint.createdAt, true)} · Responder hasta el{" "}
                  {formatDate(complaint.dueOn)}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground text-xs">Consumidor</dt>
                    <dd>
                      {complaint.consumerName} · {complaint.documentType} {complaint.documentNumber}
                      {complaint.isMinor && complaint.guardianName !== null
                        ? ` (apoderado: ${complaint.guardianName})`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Contacto</dt>
                    <dd>
                      {complaint.consumerEmail} · {complaint.consumerPhone}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Domicilio</dt>
                    <dd>{complaint.consumerAddress}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Responder por</dt>
                    <dd>
                      {complaint.responseChannel === "email" ? "Correo electronico" : "Domicilio"}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground text-xs">
                      {complaint.itemType === "producto" ? "Producto" : "Servicio"}
                      {complaint.orderReference !== null
                        ? ` · Pedido ${complaint.orderReference}`
                        : ""}
                      {complaint.amountCents !== null
                        ? ` · ${formatCurrency(complaint.amountCents, "PEN")}`
                        : ""}
                    </dt>
                    <dd>{complaint.itemDescription}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground text-xs">Detalle</dt>
                    <dd className="whitespace-pre-line">{complaint.detail}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground text-xs">Pedido del consumidor</dt>
                    <dd className="whitespace-pre-line">{complaint.consumerRequest}</dd>
                  </div>
                </dl>

                {canAnswer ? (
                  <ComplaintAnswerForm
                    tenantSlug={tenant.slug}
                    complaintId={complaint.id}
                    response={complaint.response}
                  />
                ) : complaint.response !== null ? (
                  <div className="text-sm">
                    <p className="text-muted-foreground text-xs">Respuesta</p>
                    <p className="whitespace-pre-line">{complaint.response}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
