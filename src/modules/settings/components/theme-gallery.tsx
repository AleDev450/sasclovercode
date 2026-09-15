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
   * one it was handed. That keeps the previews off the client bundle while the
   * selection - which genuinely is interaction - stays interactive.
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

      {/*
        Three columns at desktop width, because there are exactly three themes
        and a row that wraps to a second line of one card reads as "and some
        others" - which is the impression the nine-preset gallery gave and the
        reason it undersold every theme in it.
      */}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {presets.map((preset) => {
          const active = preset.id === activePresetId;

          return (
            <form
              key={preset.id}
              action={formAction}
              className={cn(
                "bg-card flex flex-col overflow-hidden rounded-2xl border transition-[border-color,box-shadow]",
                active
                  ? "border-primary ring-primary/20 shadow-e2 ring-2"
                  : "border-border shadow-e1 hover:shadow-e2",
              )}
            >
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="presetId" value={preset.id} />

              {/*
                The preview bleeds to the edges of the card.

                It used to sit inset with its own rounded border inside another
                rounded border, which framed it as an illustration OF a website.
                Edge to edge it reads as the website, which is what is actually
                being chosen.
              */}
              <div className="[&>div]:rounded-none [&>div]:border-x-0 [&>div]:border-t-0">
                {previews[preset.id]}
              </div>

              <div className="flex flex-1 flex-col gap-4 p-5">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-lg font-semibold tracking-tight">{preset.name}</h3>
                      <span className="text-muted-foreground text-xs">{preset.tagline}</span>
                    </div>
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
                  What the theme actually decides, spelled out.

                  Three swatches answered "what colour is it" and nothing else,
                  which was fine when colour was all a theme was. These four say
                  the part an owner cannot see in a 300px miniature: the face,
                  the corners, the shape of their photographs.
                */}
                <ul className="flex flex-wrap gap-1.5">
                  {preset.traits.map((trait) => (
                    <li
                      key={trait}
                      className="border-border text-muted-foreground rounded-full border px-2.5 py-0.5 text-[0.6875rem]"
                    >
                      {trait}
                    </li>
                  ))}
                </ul>

                <div className="mt-auto flex items-center gap-2">
                  {[preset.primaryColor, preset.accentColor, preset.backgroundColor].map(
                    (color) => (
                      <span
                        key={color}
                        className="border-border size-5 rounded-full border"
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ),
                  )}
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
              </div>
            </form>
          );
        })}
      </div>
    </div>
  );
}
