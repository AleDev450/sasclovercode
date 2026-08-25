"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { updateThemeAction } from "../server/actions";
import type { TenantTheme } from "../server/queries";

const FONTS = ["system", "inter", "poppins", "lora", "roboto"] as const;
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

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="fontFamily">Tipografia</Label>
          <select
            id="fontFamily"
            name="fontFamily"
            defaultValue={theme.fontFamily}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            {FONTS.map((font) => (
              <option key={font} value={font}>
                {font}
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
                {radius}
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
