import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  buttonVariants,
} from "@/components/ui";
import { IconArrowRight, IconGlobe } from "@/components/ui/icons";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { ThemeForm } from "@/modules/settings/components/theme-form";
import { ThemeGallery } from "@/modules/settings/components/theme-gallery";
import { ThemePreview } from "@/modules/settings/components/theme-preview";
import { getTenantTheme } from "@/modules/settings/server/queries";
import { THEME_PRESETS, matchPreset } from "@/modules/settings/theme-presets";

export const metadata = { title: "Tema" };

export default async function ThemePage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // Viewing a theme is not a separate permission from managing one: there is
  // nothing on this screen a person who cannot change it needs to read.
  if (!(await hasPermission(tenant.id, PERMISSIONS.SETTINGS_MANAGE))) {
    notFound();
  }

  const theme = await getTenantTheme(tenant.id);
  const active = matchPreset(theme);

  /*
   * One preview per preset, rendered here on the server.
   *
   * `ThemePreview` is a Server Component and `ThemeGallery` is a client one, so
   * the gallery cannot render them itself - it receives them as a map and
   * places them. Eight previews therefore cost nothing in the client bundle.
   */
  const previews = Object.fromEntries(
    THEME_PRESETS.map((preset) => [
      preset.id,
      <ThemePreview key={preset.id} theme={preset} businessName={tenant.name} />,
    ]),
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Tema de tu web"
        description={`Asi se vera ${tenant.name} para tus clientes. Elige un tema listo o ajusta los colores a mano.`}
        actions={
          <Link
            href={`/dashboard/${tenant.slug}/configuracion`}
            className={buttonVariants({ variant: "ghost", size: "md" })}
          >
            Volver a configuracion
          </Link>
        }
      />

      {/* ------------------------------------------------------ current state */}
      <Card variant="brand">
        <CardContent className="grid gap-6 p-6 pt-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div className="flex flex-col items-start gap-3">
            <Badge variant="brand">Tema actual</Badge>
            <h2 className="text-xl font-semibold tracking-tight">
              {active?.name ?? "Personalizado"}
            </h2>
            <p className="text-muted-foreground text-sm">
              {active?.description ??
                "Ajustaste los colores a mano, asi que este tema es unico de tu negocio."}
            </p>
            <Link
              href="/sitio"
              className={buttonVariants({ variant: "outline", size: "sm" })}
              target="_blank"
              rel="noopener noreferrer"
            >
              <IconGlobe />
              Ver mi web
              <IconArrowRight />
            </Link>
          </div>

          <ThemePreview theme={theme} businessName={tenant.name} size="full" />
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------- presets */}
      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Temas listos para usar</h2>
          <p className="text-muted-foreground text-sm">
            Un clic y tu web cambia. Puedes probar cuantos quieras: no se pierde nada de tu
            contenido.
          </p>
        </div>

        <ThemeGallery
          tenantSlug={tenant.slug}
          presets={THEME_PRESETS}
          activePresetId={active?.id ?? null}
          previews={previews}
          canEdit
        />
      </section>

      {/* ----------------------------------------------------------- custom */}
      <Card>
        <CardHeader>
          <CardTitle as="h2">Ajuste fino</CardTitle>
          <CardDescription>
            Para cuando tu negocio ya tiene colores de marca. Los cambios de aqui reemplazan al tema
            elegido arriba.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeForm tenantSlug={tenant.slug} theme={theme} />
        </CardContent>
      </Card>
    </div>
  );
}
