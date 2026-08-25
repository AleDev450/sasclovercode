"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription, Badge, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { deleteSectionAction, upsertSectionAction } from "../server/actions";
import { SECTION_LABELS, SECTION_TYPES, type SectionType } from "../sections";
import type { AdminSection } from "../server/admin-queries";

/**
 * Starting content for each type, so a new section is valid the moment it is
 * created rather than a blank the person has to decode from an error message.
 */
const TEMPLATES: Record<SectionType, unknown> = {
  hero: { heading: "Titulo principal", subheading: "" },
  text: { heading: "", paragraphs: ["Escribe aqui."] },
  image: { imagePath: "", alt: "" },
  banner: { message: "Aviso", tone: "info" },
  cta: { heading: "Titulo", buttonLabel: "Ir", buttonHref: "/" },
  gallery: { heading: "", images: [] },
  products: { heading: "", limit: 8 },
  faq: { heading: "", items: [{ question: "Pregunta", answer: "Respuesta" }] },
};

/**
 * The section editor is a JSON field, deliberately.
 *
 * A field-by-field form per type is Phase 08's job once the shapes settle; this
 * is honest about what a section is - structured data - and the schema is what
 * rejects anything malformed, with the message attached to the field that broke.
 *
 * Note what it is NOT: a rich-text box. There is nowhere to put markup, so
 * there is nothing to sanitise (master section 33).
 */
export function SectionEditor({
  tenantSlug,
  pageId,
  section,
  onDone,
}: {
  tenantSlug: string;
  pageId: string;
  section?: AdminSection;
  onDone?: () => void;
}) {
  const [state, formAction, isPending] = useActionState(upsertSectionAction, IDLE_FORM_STATE);
  const [type, setType] = useState<SectionType>(section?.type ?? "text");
  const errors = state.fieldErrors ?? {};

  const initialContent = JSON.stringify(section?.content ?? TEMPLATES[type], null, 2);

  return (
    <form
      action={formAction}
      className="border-border flex flex-col gap-4 rounded-lg border p-4"
      onSubmit={() => onDone?.()}
    >
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="pageId" value={pageId} />
      {section !== undefined ? <input type="hidden" name="sectionId" value={section.id} /> : null}

      {state.status === "success" && state.message !== undefined ? (
        <Alert variant="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`type-${section?.id ?? "new"}`}>Tipo</Label>
          <select
            id={`type-${section?.id ?? "new"}`}
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value as SectionType)}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            {SECTION_TYPES.map((value) => (
              <option key={value} value={value}>
                {SECTION_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`position-${section?.id ?? "new"}`}>Orden</Label>
          <Input
            id={`position-${section?.id ?? "new"}`}
            name="position"
            type="number"
            min={0}
            max={1000}
            defaultValue={section?.position ?? 0}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`content-${section?.id ?? "new"}`}>Contenido</Label>
        <textarea
          id={`content-${section?.id ?? "new"}`}
          name="content"
          rows={10}
          defaultValue={initialContent}
          key={`${type}-${section?.id ?? "new"}`}
          aria-invalid={Object.keys(errors).length > 0 ? true : undefined}
          className="border-input bg-background rounded-md border p-3 font-mono text-xs"
        />
        {Object.entries(errors).map(([field, messages]) => (
          <p key={field} className="text-destructive text-sm">
            <span className="font-mono">{field}</span>: {messages[0]}
          </p>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" loading={isPending} loadingLabel="Guardando">
          Guardar seccion
        </Button>
        {section !== undefined ? (
          <span className="text-muted-foreground text-xs">
            <Badge variant="neutral">{SECTION_LABELS[section.type]}</Badge>
          </span>
        ) : null}
      </div>
    </form>
  );
}

export function DeleteSectionForm({
  tenantSlug,
  pageId,
  sectionId,
}: {
  tenantSlug: string;
  pageId: string;
  sectionId: string;
}) {
  return (
    <form action={deleteSectionAction} className="flex items-center gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="pageId" value={pageId} />
      <input type="hidden" name="sectionId" value={sectionId} />
      {/* A destructive action needs a deliberate act (master section 36). The
          checkbox keeps this usable without JavaScript. */}
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" required className="size-4" />
        Confirmar
      </label>
      <Button type="submit" size="sm" variant="destructive">
        Eliminar
      </Button>
    </form>
  );
}
