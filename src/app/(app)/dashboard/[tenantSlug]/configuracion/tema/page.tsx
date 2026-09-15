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
import { BrandingForm } from "@/modules/settings/components/branding-form";
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
   * places them. The previews therefore cost nothing in the client bundle.
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
        description={`Asi se vera ${tenant.name} para tus clientes. Elige uno de los tres disenos o ajusta los detalles a mano.`}
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
                "Ajustaste el tema a mano, asi que este diseno es unico de tu negocio."}
            </p>
            {/*
              The PREVIEW, not `/sitio`.

              `/sitio` resolves its tenant from the hostname, and this link is
              being clicked on the dashboard's hostname - which belongs to no
              business, so it 404s everywhere except a machine browsing
              `{slug}.localhost`. The preview route renders the same site and
              works wherever the product is deployed.
            */}
            <Link
              href={`/vista/${tenant.slug}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <IconGlobe />
              Ver mi web
              <IconArrowRight />
            </Link>
          </div>

          <ThemePreview theme={theme} businessName={tenant.name} size="full" />
        </CardContent>
      </Card>

      {/* --------------------------------------------------------- branding */}
      <Card>
        <CardHeader>
          <CardTitle as="h2">Logo y favicon</CardTitle>
          <CardDescription>
            Tu marca, en tu web. Arrastra los archivos o eligelos de los que ya subiste.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BrandingForm
            tenantSlug={tenant.slug}
            logoPath={theme.logoPath}
            faviconPath={theme.faviconPath}
          />
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------- presets */}
      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Tres disenos para restaurante</h2>
          <p className="text-muted-foreground text-sm">
            Cada uno cambia la tipografia, el espaciado y la forma de las fotos, no solo los
            colores. Puedes probar los tres: no se pierde nada de tu contenido.
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
            Para cuando tu negocio ya tiene colores de marca. Los cambios de aqui reemplazan al
            diseno elegido arriba.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeForm tenantSlug={tenant.slug} theme={theme} />
        </CardContent>
      </Card>
    </div>
  );
}
