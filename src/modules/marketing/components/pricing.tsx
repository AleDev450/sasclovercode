import { Badge, Card, CardContent, CardHeader, buttonVariants } from "@/components/ui";
import { IconCheck } from "@/components/ui/icons";
import { formatCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";
import { listPlans } from "@/modules/platform/server/subscription-queries";

/**
 * The pricing section.
 *
 * IT READS THE REAL PRICE LIST. `plans` and `plan_modules` are the same tables
 * the billing screens read, opened to anonymous callers by the migration that
 * added this page. The alternative - three hardcoded cards - is a promise the
 * product can quietly stop keeping: somebody raises a price in the catalogue,
 * nobody remembers the landing page, and a visitor is quoted a figure the
 * system will not honour.
 *
 * The module list per plan comes from `plan_modules`, so a plan that gains a
 * capability advertises it the moment the migration lands.
 */

/** Which plan gets the emphasis. Commercial choice, so it is stated here. */
const FEATURED_PLAN = "professional";

/** How each module code reads to somebody who has not bought anything yet. */
const MODULE_LABEL: Record<string, string> = {
  website: "Pagina web con tu catalogo",
  catalog: "Catalogo, categorias y variantes",
  orders: "Pedidos, cocina y caja",
  pos: "Punto de venta en tablet",
  inventory: "Inventario, compras y recetas",
  billing: "Facturacion electronica",
  delivery: "Delivery con zonas y tarifas",
  loyalty: "Promociones, cupones y puntos",
  multi_location: "Varias sedes",
  reports: "Reportes de venta",
};

const INTERVAL_LABEL: Record<string, string> = {
  monthly: "/ mes",
  yearly: "/ ano",
};

/**
 * What a visitor sees when the price list cannot be read.
 *
 * The landing page is the one screen in this product whose job is to survive a
 * bad moment. Every other screen may legitimately show an error - the operator
 * needs to know the data is wrong - but a prospective customer who lands on a
 * 500 does not retry, they leave. So a database that is unreachable costs the
 * pricing TABLE and nothing else: the section still renders, still explains
 * what is included, and still routes to the contact form.
 */
function PricingUnavailable() {
  return (
    <Card variant="brand" className="mx-auto max-w-xl">
      <CardContent className="flex flex-col items-center gap-4 p-8 pt-8 text-center">
        {/*
          No figure here, deliberately. A price typed into a fallback is a price
          that drifts from the catalogue the moment somebody changes one, which
          is the exact failure this component exists to avoid.
        */}
        <h3 className="text-xl font-semibold tracking-tight">Tenemos un plan para tu tamano</h3>
        <p className="text-muted-foreground">
          Escribenos y te enviamos el detalle de cada plan con su precio y lo que incluye, sin
          compromiso.
        </p>
        <a href="#contacto" className={buttonVariants({ variant: "brand", size: "lg" })}>
          Ver planes y precios
        </a>
      </CardContent>
    </Card>
  );
}

export async function Pricing() {
  const catalogue = await listPlans().catch(() => null);

  if (catalogue === null) return <PricingUnavailable />;

  const plans = catalogue.filter((plan) => plan.isActive);

  if (plans.length === 0) return <PricingUnavailable />;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {plans.map((plan) => {
        const featured = plan.code === FEATURED_PLAN;

        return (
          <Card
            key={plan.code}
            variant={featured ? "elevated" : "default"}
            className={cn(
              "flex flex-col",
              featured && "border-primary/40 ring-primary/15 lg:-my-4 lg:ring-4",
            )}
          >
            <CardHeader className="gap-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold tracking-tight">{plan.name}</h3>
                {featured ? <Badge variant="brand">Mas elegido</Badge> : null}
              </div>

              <div className="flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold tracking-tight tabular-nums">
                  {formatCurrency(plan.priceCents, plan.currency)}
                </span>
                <span className="text-muted-foreground text-sm">
                  {INTERVAL_LABEL[plan.interval] ?? ""}
                </span>
              </div>

              {plan.description !== null ? (
                <p className="text-muted-foreground text-sm">{plan.description}</p>
              ) : null}

              {plan.trialDays > 0 ? (
                <p className="text-primary text-xs font-medium">
                  {plan.trialDays} dias de prueba, sin tarjeta.
                </p>
              ) : null}
            </CardHeader>

            <CardContent className="flex flex-1 flex-col gap-6">
              <ul className="flex flex-col gap-2.5">
                {plan.modules.map((module) => (
                  <li key={module} className="flex items-start gap-2.5 text-sm">
                    <IconCheck className="text-primary mt-0.5 size-4" />
                    <span>{MODULE_LABEL[module] ?? module}</span>
                  </li>
                ))}
              </ul>

              <a
                href="#contacto"
                className={cn(
                  buttonVariants({ variant: featured ? "brand" : "outline", size: "lg" }),
                  "mt-auto w-full",
                )}
              >
                Empezar con {plan.name}
              </a>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
