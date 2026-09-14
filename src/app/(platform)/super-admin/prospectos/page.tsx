import Link from "next/link";
import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  StatCard,
  StatGrid,
} from "@/components/ui";
import { IconMail, IconPhone, IconUsers, IconWhatsApp } from "@/components/ui/icons";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { LEAD_STATUS_LABEL, LeadTriageForm } from "@/modules/marketing/components/lead-triage-form";
import { getLeadCounts, listLeads, type Lead } from "@/modules/marketing/server/queries";
import type { LeadStatus } from "@/types/database";

export const metadata = { title: "Prospectos" };

const STATUS_VARIANT: Record<LeadStatus, "neutral" | "info" | "brand" | "success" | "warning"> = {
  new: "warning",
  contacted: "info",
  qualified: "brand",
  won: "success",
  lost: "neutral",
};

const FILTERS = [
  { value: undefined, label: "Todos" },
  { value: "new", label: "Sin atender" },
  { value: "contacted", label: "Contactados" },
  { value: "qualified", label: "Calificados" },
  { value: "won", label: "Ganados" },
  { value: "lost", label: "Perdidos" },
] as const;

function isLeadStatus(value: string | undefined): value is LeadStatus {
  return (
    value === "new" ||
    value === "contacted" ||
    value === "qualified" ||
    value === "won" ||
    value === "lost"
  );
}

/** A phone number as `wa.me` wants it: digits only, no `+`, no spaces. */
function toWhatsAppNumber(phone: string): string {
  return phone.replace(/\D/g, "");
}

function LeadCard({ lead }: { lead: Lead }) {
  return (
    <Card>
      <CardContent className="grid gap-6 p-6 pt-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="truncate text-base font-semibold tracking-tight">{lead.name}</h2>
              {lead.businessName !== null || lead.businessType !== null ? (
                <p className="text-muted-foreground truncate text-sm">
                  {[lead.businessName, lead.businessType].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant={STATUS_VARIANT[lead.status]} dot>
                {LEAD_STATUS_LABEL[lead.status]}
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <a
              href={`mailto:${lead.email}`}
              className="border-border hover:bg-muted flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors"
            >
              <IconMail className="size-4" />
              {lead.email}
            </a>
            {lead.phone !== null ? (
              <a
                href={`https://wa.me/${toWhatsAppNumber(lead.phone)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="border-border hover:bg-muted flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors"
              >
                <IconWhatsApp className="size-4" />
                {lead.phone}
              </a>
            ) : null}
          </div>

          {lead.message !== null ? (
            <blockquote className="border-primary/40 text-muted-foreground border-l-2 pl-4 text-sm leading-relaxed whitespace-pre-line">
              {lead.message}
            </blockquote>
          ) : (
            <p className="text-muted-foreground text-sm italic">Sin mensaje.</p>
          )}

          <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span>
              Recibido <time dateTime={lead.createdAt}>{formatRelative(lead.createdAt)}</time> (
              {formatDateTime(lead.createdAt)})
            </span>
            <span>
              Origen: <code className="font-mono">{lead.source}</code>
            </span>
            {lead.contactedAt !== null ? (
              <span>Primer contacto: {formatDateTime(lead.contactedAt)}</span>
            ) : null}
          </div>
        </div>

        <div className="bg-muted/40 border-border rounded-xl border p-4">
          <LeadTriageForm leadId={lead.id} status={lead.status} internalNote={lead.internalNote} />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The sales inbox.
 *
 * Everything the landing page produces lands here, and it is the reason the
 * contact form writes a row instead of sending an email: an inbox an operator
 * can filter, annotate and count is a funnel, whereas a mailbox is a pile.
 *
 * The filter lives in the URL rather than in component state, so a view is a
 * link an operator can bookmark or send to somebody else.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;
  const status = isLeadStatus(estado) ? estado : undefined;

  const [leads, counts] = await Promise.all([listLeads(status), getLeadCounts()]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Prospectos"
        description="Solicitudes de demostracion recibidas desde la web publica de Tu Tiendita."
      />

      <StatGrid>
        <StatCard
          label="Sin atender"
          value={counts.new}
          hint="Responder dentro de 24 horas habiles"
          icon={<IconUsers />}
          tone={counts.new > 0 ? "warning" : "success"}
        />
        <StatCard
          label="Ultimos 7 dias"
          value={counts.last7Days}
          hint={`${counts.total} recibidos en total`}
          icon={<IconPhone />}
        />
        <StatCard
          label="Calificados"
          value={counts.qualified}
          hint="Oportunidades reales en curso"
          tone="brand"
        />
        <StatCard
          label="Ganados"
          value={counts.won}
          hint={`${counts.lost} descartados`}
          tone="success"
        />
      </StatGrid>

      <nav aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => {
          const active = status === filter.value;
          return (
            <Link
              key={filter.label}
              href={filter.value === undefined ? "?" : `?estado=${filter.value}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {leads.length === 0 ? (
        <EmptyState
          title={status === undefined ? "Aun no hay prospectos" : "Ningun prospecto con ese estado"}
          description={
            status === undefined
              ? "Cuando alguien complete el formulario de la landing, aparecera aqui con sus datos de contacto."
              : "Prueba con otro filtro para ver el resto del embudo."
          }
          icon={<IconUsers className="size-8" />}
          titleAs="h2"
        />
      ) : (
        <div className="flex flex-col gap-4">
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
        </div>
      )}
    </div>
  );
}
