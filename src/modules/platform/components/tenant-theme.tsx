import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { THEME_PRESETS, matchPreset } from "@/modules/settings/theme-presets";
import type { ThemeValues } from "@/modules/seo/theme";
import { setTenantThemeAction } from "../server/actions";
import { ThemePicker } from "./theme-picker";

export interface TenantThemeCardProps {
  tenantId: string;
  /** The name printed in each miniature - what the owner will be shown. */
  tenantName: string;
  /** The theme as stored, from `getPlatformTenantTheme`. */
  theme: ThemeValues;
}

/**
 * The theme of a business, from the operator's side of the product.
 *
 * WHY IT IS HERE. Onboarding happens in the super-admin: an operator creates
 * the company, points the domain at it, sets the plan and hands it over. The
 * theme belongs to that sequence - it is what the owner sees first - and
 * leaving them to discover `configuracion/tema` themselves means the handover
 * happens on whatever the column defaults are.
 *
 * WHY IT IS STILL THE TENANT'S. The card changes one thing and says whose
 * decision it overrides. An owner who has customised their theme is shown as
 * customised rather than quietly matched to the nearest preset, so an operator
 * reapplying one knows they are discarding work somebody did deliberately.
 *
 * A Server Component, like the status form above it on the same page and for
 * the same reason: a `<form action={...}>` posting to a Server Action needs no
 * client bundle, and the answer to "did it work" is the page it comes back to,
 * where the badge either says the new theme's name or does not.
 */
export function TenantThemeCard({ tenantId, tenantName, theme }: TenantThemeCardProps) {
  const active = matchPreset(theme);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle as="h2">Tema del sitio</CardTitle>
          {active !== undefined ? (
            <Badge variant="brand">{active.name}</Badge>
          ) : (
            <Badge variant="warning">Personalizado</Badge>
          )}
        </div>
        <CardDescription>
          {active !== undefined
            ? `${active.tagline}. Es lo primero que vera el propietario al entrar.`
            : "El propietario ajusto el tema a mano. Aplicar uno de estos reemplazara esos cambios."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={setTenantThemeAction} className="flex flex-col gap-5">
          <input type="hidden" name="tenantId" value={tenantId} />

          <ThemePicker
            presets={THEME_PRESETS}
            businessName={tenantName}
            /*
             * Falls back to the first theme when this business has customised
             * its own. A radio group with nothing checked posts no value at
             * all, so the operator would press the button and be told the theme
             * does not exist - and the card above already says the current
             * theme is custom, so nothing is being misrepresented.
             */
            defaultValue={active?.id ?? THEME_PRESETS[0]?.id ?? ""}
            legend="Tema"
            description="Tipografia, ritmo y forma de las fotos, ademas de los colores."
          />

          <div>
            <Button type="submit">Aplicar tema</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
