import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { CreateTenantForm } from "@/modules/platform/components/create-tenant-form";
import { ThemePicker } from "@/modules/platform/components/theme-picker";
import { DEFAULT_PRESET_ID, THEME_PRESETS } from "@/modules/settings/theme-presets";

export const metadata = { title: "Crear empresa" };

export default function NewTenantPage() {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Crear empresa</h1>
        <p className="text-muted-foreground text-sm">
          Se creara la empresa, su dominio de sistema, su propietario y su tema en una sola
          operacion.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Datos de la empresa</CardTitle>
          <CardDescription>
            Si algo falla, no se crea nada: la operacion es atomica.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/*
            The picker is built HERE, as a Server Component, and handed to the
            client form. Three full previews therefore cost nothing in the
            bundle a browser downloads to type four fields.

            The business does not exist yet, so the miniatures are headed "Tu
            negocio": using the value of the name field would mean making them
            interactive, and a live-updating miniature is not worth a client
            bundle on this screen.
          */}
          <CreateTenantForm
            themePicker={
              <ThemePicker
                presets={THEME_PRESETS}
                businessName="Tu negocio"
                defaultValue={DEFAULT_PRESET_ID}
                legend="Tema del sitio"
                description="Lo primero que vera el propietario. Se puede cambiar despues."
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
