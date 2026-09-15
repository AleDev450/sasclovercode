"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { updateThemeAction } from "../server/actions";
import { THEME_FONTS, THEME_STYLES } from "../schemas";
import type { TenantTheme } from "../server/queries";

/**
 * Labels, because a `<select>` full of lowercase keys is a database column with
 * a dropdown on it. An owner choosing type should be reading the name of a
 * typeface, not the string it happens to be stored as.
 */
const FONT_LABELS: Record<(typeof THEME_FONTS)[number], string> = {
  system: "Del sistema",
  inter: "Inter — sans moderna",
  jost: "Jost — sans geometrica",
  "dm-sans": "DM Sans — sans abierta",
  cormorant: "Cormorant — serif fina",
  playfair: "Playfair — serif editorial",
  fraunces: "Fraunces — serif con peso",
};

const STYLE_LABELS: Record<(typeof THEME_STYLES)[number], string> = {
  atelier: "Atelier — alta cocina",
  brasa: "Brasa — parrilla y criollo",
  marea: "Marea — cevicheria y marina",
};

const RADIUS_LABELS = {
  none: "Recto",
  sm: "Apenas redondeado",
  md: "Redondeado",
  lg: "Muy redondeado",
  full: "Circular",
} as const;

const RADII = ["none", "sm", "md", "lg", "full"] as const;

function ColorField({
  name,
  label,
  value,
  errors,
}: {
  name: string;
  label: string;
  value: string;
  errors?: readonly string[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <div className="flex items-center gap-2">
        {/* A colour input alone cannot be typed into or pasted; the text field
            is the accessible path and the one the form actually submits. */}
        <Input
          id={name}
          name={name}
          defaultValue={value}
          invalid={errors !== undefined}
          aria-describedby={errors !== undefined ? `${name}-error` : undefined}
          className="font-mono"
        />
        <span
          aria-hidden="true"
          className="border-border size-9 shrink-0 rounded-md border"
          style={{ backgroundColor: value }}
        />
      </div>
      {errors !== undefined ? (
        <p id={`${name}-error`} className="text-destructive text-sm">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

export function ThemeForm({ tenantSlug, theme }: { tenantSlug: string; theme: TenantTheme }) {
  const [state, formAction, isPending] = useActionState(updateThemeAction, IDLE_FORM_STATE);
  const e = state.fieldErrors ?? {};

  /*
   * A row written before the theme rework can hold `poppins`, `lora` or
   * `roboto`, which are still legal in the database and no longer offered here.
   * Passing one straight to `defaultValue` would select nothing, so the browser
   * would show - and on save submit - whatever option happens to be first,
   * silently changing the typeface of a business that came to edit a colour.
   * Falling back to `system` makes the change visible in the field first.
   */
  const selectableFont = (THEME_FONTS as readonly string[]).includes(theme.fontFamily)
    ? theme.fontFamily
    : "system";

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      {state.status === "success" && state.message !== undefined ? (
        <Alert variant="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-3">
        <ColorField
          name="primaryColor"
          label="Color principal"
          value={theme.primaryColor}
          errors={e.primaryColor}
        />
        <ColorField
          name="accentColor"
          label="Color de acento"
          value={theme.accentColor}
          errors={e.accentColor}
        />
        <ColorField
          name="backgroundColor"
          label="Fondo"
          value={theme.backgroundColor}
          errors={e.backgroundColor}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        {/*
          The style first, because it decides more than the other two together:
          the display face, the vertical rhythm, the shape of every photograph.
          It is the one field here that can make a page look like a different
          restaurant.
        */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="style">Estilo de diseno</Label>
          <select
            id="style"
            name="style"
            defaultValue={theme.style}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            aria-describedby="style-help"
          >
            {THEME_STYLES.map((style) => (
              <option key={style} value={style}>
                {STYLE_LABELS[style]}
              </option>
            ))}
          </select>
          <p id="style-help" className="text-muted-foreground text-xs">
            Tipografia de titulos, espaciado y forma de las fotos.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="fontFamily">Tipografia del texto</Label>
          <select
            id="fontFamily"
            name="fontFamily"
            defaultValue={selectableFont}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            {THEME_FONTS.map((font) => (
              <option key={font} value={font}>
                {FONT_LABELS[font]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="borderRadius">Redondeo</Label>
          <select
            id="borderRadius"
            name="borderRadius"
            defaultValue={theme.borderRadius}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            {RADII.map((radius) => (
              <option key={radius} value={radius}>
                {RADIUS_LABELS[radius]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar tema
        </Button>
      </div>
    </form>
  );
}
