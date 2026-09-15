"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Badge, Button } from "@/components/ui";
import { IconCheck } from "@/components/ui/icons";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { cn } from "@/lib/utils";
import type { ThemePreset } from "../theme-presets";
import { applyThemePresetAction } from "../server/actions";

export interface ThemeGalleryProps {
  tenantSlug: string;
  presets: readonly ThemePreset[];
  /** The preset currently in use, or null when the theme has been customised. */
  activePresetId: string | null;
  /**
   * One preview per preset, rendered on the server.
   *
   * Passed as children rather than imported here because `ThemePreview` is a
   * Server Component: a client component cannot render one, but it can place
   * one it was handed. That keeps eight previews off the client bundle while
   * the selection - which genuinely is interaction - stays interactive.
   */
  previews: Readonly<Record<string, React.ReactNode>>;
  /** False when the person may look but not change it. */
  canEdit: boolean;
}

export function ThemeGallery({
  tenantSlug,
  presets,
  activePresetId,
  previews,
  canEdit,
}: ThemeGalleryProps) {
  const [state, formAction, isPending] = useActionState(applyThemePresetAction, IDLE_FORM_STATE);

  return (
    <div className="flex flex-col gap-5">
      {state.status !== "idle" && state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "destructive"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {presets.map((preset) => {
          const active = preset.id === activePresetId;

          return (
            <form
              key={preset.id}
              action={formAction}
              className={cn(
                "bg-card flex flex-col gap-4 rounded-xl border p-4 transition-[border-color,box-shadow]",
                active ? "border-primary ring-primary/20 ring-2" : "border-border shadow-e1",
              )}
            >
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="presetId" value={preset.id} />

              {previews[preset.id]}

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold tracking-tight">{preset.name}</h3>
                  {active ? (
                    <Badge variant="brand">
                      <IconCheck className="size-3" />
                      En uso
                    </Badge>
                  ) : null}
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {preset.description}
                </p>
              </div>

              {/*
                The palette, spelled out. Somebody comparing two presets is
                comparing colours, and three swatches answer that faster than
                reading two descriptions.
              */}
              <div className="flex items-center gap-1.5">
                {[preset.primaryColor, preset.accentColor, preset.backgroundColor].map((color) => (
                  <span
                    key={color}
                    className="border-border size-5 rounded-full border"
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
                <span className="text-muted-foreground ml-auto font-mono text-[0.6875rem]">
                  {preset.fontFamily}
                </span>
              </div>

              {canEdit ? (
                <Button
                  type="submit"
                  variant={active ? "outline" : "default"}
                  size="sm"
                  disabled={active}
                  loading={isPending}
                  loadingLabel="Aplicando"
                  className="w-full"
                >
                  {active ? "Tema actual" : `Usar ${preset.name}`}
                </Button>
              ) : null}
            </form>
          );
        })}
      </div>
    </div>
  );
}
