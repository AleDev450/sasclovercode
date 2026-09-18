"use client";

/**
 * The section editor.
 *
 * WHAT IT REPLACES. A plain text box containing the section's raw JSON, with
 * the note that a field-by-field form was "Phase 08's job once the shapes
 * settle". They settled. What was left was a content editor that asked a baker
 * to balance braces, where a missing comma lost the whole section and an image
 * meant pasting `tenants/6f2e.../products/foto.jpg` from somewhere else.
 *
 * WHAT DID NOT CHANGE, AND MUST NOT. Every field below is still plain text, a
 * URL, or a list of those. There is no rich-text box, no HTML field and nothing
 * to sanitise, because nothing accepts markup (master section 33). The server
 * validates against exactly the same schemas as before - this form is a nicer
 * way to produce the same JSON, not a second way to write content.
 *
 * HOW THE VALUE TRAVELS. The fields are React state, serialised into one hidden
 * input on every keystroke, and `upsertSectionAction` parses that as it always
 * has. The alternative - naming every input so the server could reassemble
 * `content.images[2].alt` - would have meant inventing a form encoding and a
 * parser for it, and the parser would be the new place for a bug in the one
 * code path that decides what a business publishes.
 */

import { useActionState, useId, useState } from "react";
import type { ComponentType } from "react";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";
import type { IconProps } from "@/components/ui/icons";
import {
  IconArrowUpRight,
  IconCard,
  IconChevronDown,
  IconChevronUp,
  IconEye,
  IconEyeOff,
  IconGrid,
  IconImage,
  IconLayout,
  IconMegaphone,
  IconPlay,
  IconPlus,
  IconQuestion,
  IconSparkle,
  IconTrash,
  IconTrendUp,
  IconType,
} from "@/components/ui/icons";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { cn } from "@/lib/utils";
import { AssetPicker } from "@/modules/assets/components/asset-picker";
import {
  deleteSectionAction,
  moveSectionAction,
  toggleSectionVisibilityAction,
  upsertSectionAction,
} from "../server/actions";
import { SECTION_LABELS, SECTION_TYPES, type SectionType } from "../sections";
import { BANNER_TONES, SECTION_META, SECTION_TEMPLATES } from "../section-meta";
import type { AdminSection } from "../server/admin-queries";

const SECTION_ICONS: Record<string, ComponentType<IconProps>> = {
  hero: IconLayout,
  text: IconType,
  image: IconImage,
  banner: IconMegaphone,
  cta: IconSparkle,
  gallery: IconGrid,
  products: IconCard,
  faq: IconQuestion,
  slider: IconPlay,
  shortcuts: IconArrowUpRight,
  bestsellers: IconTrendUp,
};

function SectionGlyph({ type, className }: { type: SectionType; className?: string }) {
  const Glyph = SECTION_ICONS[SECTION_META[type].icon] ?? IconLayout;
  return <Glyph className={cn("size-4", className)} />;
}

/** A category the `products` section may point at. */
export interface CategoryChoice {
  readonly slug: string;
  readonly name: string;
}

type Content = Record<string, unknown>;

/* -------------------------------------------------------------------------- */
/*  Small field helpers                                                        */
/* -------------------------------------------------------------------------- */

function TextField({
  label,
  value,
  onChange,
  hint,
  errors,
  placeholder,
  maxLength,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  errors?: readonly string[];
  placeholder?: string;
  maxLength?: number;
  type?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        invalid={errors !== undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {errors !== undefined ? (
        <p className="text-destructive text-xs">{errors[0]}</p>
      ) : hint !== undefined ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

function LongTextField({
  label,
  value,
  onChange,
  hint,
  errors,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  errors?: readonly string[];
  rows?: number;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={rows}
        value={value}
        invalid={errors !== undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {errors !== undefined ? (
        <p className="text-destructive text-xs">{errors[0]}</p>
      ) : hint !== undefined ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

/** The header of one entry in a repeatable list, with its remove button. */
function RowHeader({
  title,
  onRemove,
  canRemove,
}: {
  title: string;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground text-xs font-medium">{title}</span>
      {canRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive inline-flex items-center gap-1 text-xs transition-colors"
        >
          <IconTrash className="size-3.5" />
          Quitar
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The fields of each section type                                            */
/* -------------------------------------------------------------------------- */

function SectionFields({
  type,
  content,
  set,
  tenantSlug,
  categories,
  errors,
}: {
  type: SectionType;
  content: Content;
  set: (patch: Content) => void;
  tenantSlug: string;
  categories: readonly CategoryChoice[];
  errors: Readonly<Record<string, readonly string[]>>;
}) {
  /** Reads a string field, whatever the row happens to hold. */
  const str = (key: string): string => {
    const value = content[key];
    return typeof value === "string" ? value : "";
  };

  const list = <T,>(key: string): T[] => {
    const value = content[key];
    return Array.isArray(value) ? (value as T[]) : [];
  };

  switch (type) {
    case "hero":
      return (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <TextField
              label="Titular"
              value={str("heading")}
              maxLength={120}
              errors={errors.heading}
              onChange={(value) => set({ heading: value })}
            />
            <LongTextField
              label="Subtitulo"
              value={str("subheading")}
              rows={3}
              hint="Opcional. Una linea que explique que ofreces."
              errors={errors.subheading}
              onChange={(value) => set({ subheading: value })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Texto del boton"
                value={str("ctaLabel")}
                maxLength={40}
                placeholder="Ver la carta"
                errors={errors.ctaLabel}
                onChange={(value) => set({ ctaLabel: value })}
              />
              <TextField
                label="Enlace del boton"
                value={str("ctaHref")}
                placeholder="/sitio/carta"
                hint="Una ruta interna o un enlace https://"
                errors={errors.ctaHref}
                onChange={(value) => set({ ctaHref: value })}
              />
            </div>
          </div>

          <AssetPicker
            tenantSlug={tenantSlug}
            folder="banners"
            label="Imagen de portada"
            aspect="wide"
            hint="Opcional. Se muestra junto al titular."
            value={str("imagePath") || null}
            onChange={(path) => set({ imagePath: path ?? undefined })}
          />
        </div>
      );

    case "text": {
      const paragraphs = list<string>("paragraphs");
      const shown = paragraphs.length > 0 ? paragraphs : [""];

      return (
        <div className="flex flex-col gap-4">
          <TextField
            label="Titulo"
            value={str("heading")}
            maxLength={120}
            hint="Opcional."
            errors={errors.heading}
            onChange={(value) => set({ heading: value })}
          />

          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium">Parrafos</span>
            {shown.map((paragraph, index) => (
              <div key={index} className="border-border flex flex-col gap-2 rounded-lg border p-3">
                <RowHeader
                  title={`Parrafo ${index + 1}`}
                  canRemove={shown.length > 1}
                  onRemove={() =>
                    set({ paragraphs: shown.filter((_, position) => position !== index) })
                  }
                />
                <LongTextField
                  label={`Texto del parrafo ${index + 1}`}
                  value={paragraph}
                  rows={3}
                  errors={errors[`paragraphs.${index}`]}
                  onChange={(value) =>
                    set({
                      paragraphs: shown.map((item, position) =>
                        position === index ? value : item,
                      ),
                    })
                  }
                />
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set({ paragraphs: [...shown, ""] })}
              >
                <IconPlus />
                Anadir parrafo
              </Button>
            </div>
          </div>
        </div>
      );
    }

    case "image":
      return (
        <div className="grid gap-5 lg:grid-cols-2">
          <AssetPicker
            tenantSlug={tenantSlug}
            folder="banners"
            label="Imagen"
            aspect="wide"
            value={str("imagePath") || null}
            onChange={(path) => set({ imagePath: path ?? "" })}
          />
          <div className="flex flex-col gap-4">
            <TextField
              label="Texto alternativo"
              value={str("alt")}
              maxLength={200}
              hint="Describe la foto para quien no puede verla. Es obligatorio."
              errors={errors.alt}
              onChange={(value) => set({ alt: value })}
            />
            <TextField
              label="Pie de foto"
              value={str("caption")}
              maxLength={200}
              hint="Opcional. Se muestra debajo de la imagen."
              errors={errors.caption}
              onChange={(value) => set({ caption: value })}
            />
            {errors.imagePath !== undefined ? (
              <p className="text-destructive text-xs">{errors.imagePath[0]}</p>
            ) : null}
          </div>
        </div>
      );

    case "banner": {
      const toneId = "tone";
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Mensaje"
            value={str("message")}
            maxLength={200}
            errors={errors.message}
            onChange={(value) => set({ message: value })}
          />
          <TextField
            label="Enlace"
            value={str("href")}
            hint="Opcional. Ruta interna o https://"
            errors={errors.href}
            onChange={(value) => set({ href: value })}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={toneId}>Tono</Label>
            <Select
              id={toneId}
              value={str("tone") || "info"}
              onChange={(event) => set({ tone: event.target.value })}
            >
              {BANNER_TONES.map((tone) => (
                <option key={tone.value} value={tone.value}>
                  {tone.label}
                </option>
              ))}
            </Select>
            <p className="text-muted-foreground text-xs">
              El color del aviso no depende de tu tema: un aviso de atencion se ve igual en todas
              las webs.
            </p>
          </div>
        </div>
      );
    }

    case "cta":
      return (
        <div className="flex flex-col gap-4">
          <TextField
            label="Titulo"
            value={str("heading")}
            maxLength={120}
            errors={errors.heading}
            onChange={(value) => set({ heading: value })}
          />
          <LongTextField
            label="Texto"
            value={str("body")}
            rows={2}
            hint="Opcional."
            errors={errors.body}
            onChange={(value) => set({ body: value })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Texto del boton"
              value={str("buttonLabel")}
              maxLength={40}
              errors={errors.buttonLabel}
              onChange={(value) => set({ buttonLabel: value })}
            />
            <TextField
              label="Enlace del boton"
              value={str("buttonHref")}
              placeholder="/sitio/contacto"
              errors={errors.buttonHref}
              onChange={(value) => set({ buttonHref: value })}
            />
          </div>
          <AssetPicker
            tenantSlug={tenantSlug}
            folder="banners"
            label="Foto de fondo"
            aspect="wide"
            hint="Opcional. Con foto, el bloque se convierte en una imagen a lo ancho con el boton encima."
            value={str("imagePath") || null}
            onChange={(path) => set({ imagePath: path ?? undefined })}
          />
        </div>
      );

    case "gallery": {
      const images = list<{ imagePath?: string; alt?: string }>("images");

      return (
        <div className="flex flex-col gap-4">
          <TextField
            label="Titulo"
            value={str("heading")}
            maxLength={120}
            hint="Opcional."
            errors={errors.heading}
            onChange={(value) => set({ heading: value })}
          />

          {errors.images !== undefined ? (
            <p className="text-destructive text-xs">{errors.images[0]}</p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((image, index) => (
              <div key={index} className="border-border flex flex-col gap-3 rounded-lg border p-3">
                <RowHeader
                  title={`Foto ${index + 1}`}
                  canRemove
                  onRemove={() =>
                    set({ images: images.filter((_, position) => position !== index) })
                  }
                />
                <AssetPicker
                  tenantSlug={tenantSlug}
                  folder="banners"
                  label={`Imagen ${index + 1}`}
                  aspect="square"
                  value={image.imagePath ?? null}
                  onChange={(path) =>
                    set({
                      images: images.map((item, position) =>
                        position === index ? { ...item, imagePath: path ?? "" } : item,
                      ),
                    })
                  }
                />
                <TextField
                  label={`Descripcion de la imagen ${index + 1}`}
                  value={image.alt ?? ""}
                  maxLength={200}
                  errors={errors[`images.${index}.alt`]}
                  onChange={(value) =>
                    set({
                      images: images.map((item, position) =>
                        position === index ? { ...item, alt: value } : item,
                      ),
                    })
                  }
                />
              </div>
            ))}
          </div>

          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set({ images: [...images, { imagePath: "", alt: "" }] })}
            >
              <IconPlus />
              Anadir foto
            </Button>
          </div>
        </div>
      );
    }

    case "products": {
      const limitId = "limit";
      const categoryId = "category";
      const limit = typeof content.limit === "number" ? content.limit : 8;

      return (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="Titulo"
              value={str("heading")}
              maxLength={120}
              hint="Opcional."
              errors={errors.heading}
              onChange={(value) => set({ heading: value })}
            />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={limitId}>Cuantos mostrar</Label>
              <Input
                id={limitId}
                type="number"
                min={1}
                max={24}
                value={limit}
                invalid={errors.limit !== undefined}
                onChange={(event) => set({ limit: Number(event.target.value) })}
              />
              {errors.limit !== undefined ? (
                <p className="text-destructive text-xs">{errors.limit[0]}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={categoryId}>Categoria</Label>
              <Select
                id={categoryId}
                value={str("categorySlug")}
                onChange={(event) =>
                  set({ categorySlug: event.target.value === "" ? undefined : event.target.value })
                }
              >
                <option value="">Toda la carta</option>
                {categories.map((category) => (
                  <option key={category.slug} value={category.slug}>
                    {category.name}
                  </option>
                ))}
              </Select>
              {errors.categorySlug !== undefined ? (
                <p className="text-destructive text-xs">{errors.categorySlug[0]}</p>
              ) : null}
            </div>
          </div>

          <p className="text-muted-foreground text-xs">
            Esta seccion no guarda productos: los lee de tu catalogo al mostrar la pagina. Si
            cambias un precio, aqui cambia solo. Los destacados salen primero.
          </p>
        </div>
      );
    }

    case "faq": {
      const items = list<{ question?: string; answer?: string }>("items");
      const shown = items.length > 0 ? items : [{ question: "", answer: "" }];

      return (
        <div className="flex flex-col gap-4">
          <TextField
            label="Titulo"
            value={str("heading")}
            maxLength={120}
            hint="Opcional."
            errors={errors.heading}
            onChange={(value) => set({ heading: value })}
          />

          <div className="flex flex-col gap-3">
            {shown.map((item, index) => (
              <div key={index} className="border-border flex flex-col gap-3 rounded-lg border p-3">
                <RowHeader
                  title={`Pregunta ${index + 1}`}
                  canRemove={shown.length > 1}
                  onRemove={() => set({ items: shown.filter((_, position) => position !== index) })}
                />
                <TextField
                  label={`Pregunta ${index + 1}`}
                  value={item.question ?? ""}
                  maxLength={200}
                  errors={errors[`items.${index}.question`]}
                  onChange={(value) =>
                    set({
                      items: shown.map((row, position) =>
                        position === index ? { ...row, question: value } : row,
                      ),
                    })
                  }
                />
                <LongTextField
                  label={`Respuesta ${index + 1}`}
                  value={item.answer ?? ""}
                  rows={3}
                  errors={errors[`items.${index}.answer`]}
                  onChange={(value) =>
                    set({
                      items: shown.map((row, position) =>
                        position === index ? { ...row, answer: value } : row,
                      ),
                    })
                  }
                />
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set({ items: [...shown, { question: "", answer: "" }] })}
              >
                <IconPlus />
                Anadir pregunta
              </Button>
            </div>
          </div>
        </div>
      );
    }

    case "slider": {
      type Slide = {
        imagePath?: string;
        mobileImagePath?: string;
        heading?: string;
        subheading?: string;
        ctaLabel?: string;
        ctaHref?: string;
        overlay?: number;
      };
      const slides = list<Slide>("slides");
      const intervalId = "interval";
      const interval = typeof content.intervalSeconds === "number" ? content.intervalSeconds : 6;

      const patchSlide = (index: number, patch: Partial<Slide>) =>
        set({
          slides: slides.map((slide, position) =>
            position === index ? { ...slide, ...patch } : slide,
          ),
        });

      /** An emptied optional link is removed, not stored as "" - which the schema refuses. */
      const optional = (value: string): string | undefined =>
        value.trim() === "" ? undefined : value;

      return (
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-xs">
            Sin fotos, la portada muestra el nombre y el eslogan de tu negocio con los botones de la
            carta. Sube una foto de 1920 x 1080 para computadora y, si puedes, otra vertical de 1080
            x 1920 para celular: asi no se recorta lo importante.
          </p>

          {errors.slides !== undefined ? (
            <p className="text-destructive text-xs">{errors.slides[0]}</p>
          ) : null}

          {slides.map((slide, index) => (
            <div key={index} className="border-border flex flex-col gap-4 rounded-lg border p-4">
              <RowHeader
                title={`Diapositiva ${index + 1}`}
                canRemove
                onRemove={() => set({ slides: slides.filter((_, position) => position !== index) })}
              />

              <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                <div className="flex flex-col gap-1.5">
                  <AssetPicker
                    tenantSlug={tenantSlug}
                    folder="banners"
                    label={`Foto para computadora ${index + 1}`}
                    aspect="wide"
                    hint="Obligatoria. 1920 x 1080."
                    value={slide.imagePath || null}
                    onChange={(path) => patchSlide(index, { imagePath: path ?? "" })}
                  />
                  {errors[`slides.${index}.imagePath`] !== undefined ? (
                    <p className="text-destructive text-xs">Sube la foto para computadora.</p>
                  ) : null}
                </div>
                <AssetPicker
                  tenantSlug={tenantSlug}
                  folder="banners"
                  label={`Foto para celular ${index + 1}`}
                  aspect="square"
                  hint="Opcional. Vertical, 1080 x 1920."
                  value={slide.mobileImagePath || null}
                  onChange={(path) => patchSlide(index, { mobileImagePath: path ?? undefined })}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Titular"
                  value={slide.heading ?? ""}
                  maxLength={120}
                  hint="Opcional. Sin texto, la foto se ve tal cual."
                  errors={errors[`slides.${index}.heading`]}
                  onChange={(value) => patchSlide(index, { heading: value })}
                />
                <TextField
                  label="Subtitulo"
                  value={slide.subheading ?? ""}
                  maxLength={300}
                  errors={errors[`slides.${index}.subheading`]}
                  onChange={(value) => patchSlide(index, { subheading: value })}
                />
                <TextField
                  label="Texto del boton"
                  value={slide.ctaLabel ?? ""}
                  maxLength={40}
                  placeholder="Pedir ahora"
                  errors={errors[`slides.${index}.ctaLabel`]}
                  onChange={(value) => patchSlide(index, { ctaLabel: value })}
                />
                <TextField
                  label="Enlace"
                  value={slide.ctaHref ?? ""}
                  placeholder="/sitio/carta"
                  hint="Toda la foto lleva a este enlace."
                  errors={errors[`slides.${index}.ctaHref`]}
                  onChange={(value) => patchSlide(index, { ctaHref: optional(value) })}
                />
                <TextField
                  label="Oscurecer bajo el texto (0 a 90)"
                  type="number"
                  value={String(slide.overlay ?? 35)}
                  errors={errors[`slides.${index}.overlay`]}
                  onChange={(value) => patchSlide(index, { overlay: Number(value) })}
                />
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-end gap-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={slides.length >= 8}
              onClick={() => set({ slides: [...slides, { imagePath: "", overlay: 35 }] })}
            >
              <IconPlus />
              Anadir diapositiva
            </Button>

            <div className="flex w-40 flex-col gap-1.5">
              <Label htmlFor={intervalId}>Segundos por foto</Label>
              <Input
                id={intervalId}
                type="number"
                min={3}
                max={15}
                value={interval}
                invalid={errors.intervalSeconds !== undefined}
                onChange={(event) => set({ intervalSeconds: Number(event.target.value) })}
              />
            </div>
          </div>
        </div>
      );
    }

    case "shortcuts": {
      type ShortcutCard = {
        title?: string;
        body?: string;
        imagePath?: string;
        href?: string;
        linkLabel?: string;
      };
      const cards = list<ShortcutCard>("cards");
      const shown = cards.length > 0 ? cards : [{ title: "", href: "/sitio/carta" }];

      const patchCard = (index: number, patch: Partial<ShortcutCard>) =>
        set({
          cards: shown.map((card, position) => (position === index ? { ...card, ...patch } : card)),
        });

      return (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {shown.map((card, index) => (
              <div key={index} className="border-border flex flex-col gap-3 rounded-lg border p-3">
                <RowHeader
                  title={`Tarjeta ${index + 1}`}
                  canRemove={shown.length > 1}
                  onRemove={() => set({ cards: shown.filter((_, position) => position !== index) })}
                />
                <AssetPicker
                  tenantSlug={tenantSlug}
                  folder="banners"
                  label={`Foto de la tarjeta ${index + 1}`}
                  aspect="wide"
                  hint="Opcional. Sin foto se usa el color de tu marca."
                  value={card.imagePath || null}
                  onChange={(path) => patchCard(index, { imagePath: path ?? undefined })}
                />
                <TextField
                  label="Titulo"
                  value={card.title ?? ""}
                  maxLength={60}
                  errors={errors[`cards.${index}.title`]}
                  onChange={(value) => patchCard(index, { title: value })}
                />
                <LongTextField
                  label="Texto"
                  value={card.body ?? ""}
                  rows={2}
                  errors={errors[`cards.${index}.body`]}
                  onChange={(value) => patchCard(index, { body: value })}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField
                    label="Enlace"
                    value={card.href ?? ""}
                    placeholder="/sitio/carta"
                    errors={errors[`cards.${index}.href`]}
                    onChange={(value) => patchCard(index, { href: value })}
                  />
                  <TextField
                    label="Texto del enlace"
                    value={card.linkLabel ?? ""}
                    maxLength={40}
                    placeholder="Ver mas"
                    errors={errors[`cards.${index}.linkLabel`]}
                    onChange={(value) => patchCard(index, { linkLabel: value })}
                  />
                </div>
              </div>
            ))}
          </div>

          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={shown.length >= 4}
              onClick={() => set({ cards: [...shown, { title: "", href: "/sitio/carta" }] })}
            >
              <IconPlus />
              Anadir tarjeta
            </Button>
          </div>
        </div>
      );
    }

    case "bestsellers": {
      const limitId = "bestsellers-limit";
      const limit = typeof content.limit === "number" ? content.limit : 4;

      return (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Texto pequeno"
              value={str("eyebrow")}
              maxLength={60}
              errors={errors.eyebrow}
              onChange={(value) => set({ eyebrow: value })}
            />
            <TextField
              label="Titulo"
              value={str("heading")}
              maxLength={120}
              errors={errors.heading}
              onChange={(value) => set({ heading: value })}
            />
            <TextField
              label="Texto del enlace a la carta"
              value={str("linkLabel")}
              maxLength={40}
              errors={errors.linkLabel}
              onChange={(value) => set({ linkLabel: value })}
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={limitId}>Cuantos mostrar</Label>
              <Input
                id={limitId}
                type="number"
                min={2}
                max={12}
                value={limit}
                invalid={errors.limit !== undefined}
                onChange={(event) => set({ limit: Number(event.target.value) })}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            Se calcula solo con lo que mas vendiste en los ultimos dias (lo configuras en Tienda
            online). Mientras no tengas ventas, se muestran tus productos destacados.
          </p>
        </div>
      );
    }

    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  The form around them                                                       */
/* -------------------------------------------------------------------------- */

export function SectionEditor({
  tenantSlug,
  pageId,
  section,
  categories = [],
  position,
  onSaved,
}: {
  tenantSlug: string;
  pageId: string;
  section?: AdminSection;
  categories?: readonly CategoryChoice[];
  /** Where a NEW section lands. Ignored when editing an existing one. */
  position?: number;
  onSaved?: () => void;
}) {
  const [state, formAction, isPending] = useActionState(upsertSectionAction, IDLE_FORM_STATE);
  const typeId = useId();

  const [type, setType] = useState<SectionType>(section?.type ?? "hero");
  const [content, setContent] = useState<Content>(() =>
    section !== undefined && typeof section.content === "object" && section.content !== null
      ? (section.content as Content)
      : { ...SECTION_TEMPLATES[section?.type ?? "hero"] },
  );

  const errors = state.fieldErrors ?? {};

  /*
   * Changing the type of an EXISTING section keeps nothing.
   *
   * The shapes do not overlap enough to be worth merging - a gallery has
   * `images`, a banner has `message` - and carrying stale keys across would
   * fail validation against the new schema with an error naming a field the
   * person cannot see. Resetting to the template is the honest behaviour.
   */
  function changeType(next: SectionType) {
    setType(next);
    setContent({ ...SECTION_TEMPLATES[next] });
  }

  const set = (patch: Content) => setContent((current) => ({ ...current, ...patch }));

  return (
    <form action={formAction} className="flex flex-col gap-5" onSubmit={() => onSaved?.()}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="pageId" value={pageId} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="position" value={section?.position ?? position ?? 0} />
      {section !== undefined ? <input type="hidden" name="sectionId" value={section.id} /> : null}
      {/* The whole section, as the server has always received it. */}
      <input type="hidden" name="content" value={JSON.stringify(content)} />

      {state.status === "success" && state.message !== undefined ? (
        <Alert variant="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {section === undefined ? (
        /* --------------------------------------------- choosing a type */
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">Que quieres anadir?</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {SECTION_TYPES.map((value) => {
              const meta = SECTION_META[value];
              const selected = value === type;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => changeType(value)}
                  aria-pressed={selected}
                  className={cn(
                    "focus-visible:outline-ring flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-[border-color,box-shadow,background-color] focus-visible:outline-2 focus-visible:outline-offset-2",
                    selected
                      ? "border-primary bg-accent/50 ring-primary/20 ring-2"
                      : "border-border hover:border-primary/40 hover:bg-accent/30",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 items-center justify-center rounded-lg",
                      selected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                    )}
                  >
                    <SectionGlyph type={value} />
                  </span>
                  <span className="text-sm font-medium">{meta.label}</span>
                  <span className="text-muted-foreground text-xs leading-snug">
                    {meta.description}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : (
        /* ------------------------------------- changing an existing one */
        <div className="flex max-w-xs flex-col gap-1.5">
          <Label htmlFor={typeId}>Tipo de seccion</Label>
          <Select
            id={typeId}
            value={type}
            onChange={(event) => changeType(event.target.value as SectionType)}
          >
            {SECTION_TYPES.map((value) => (
              <option key={value} value={value}>
                {SECTION_LABELS[value]}
              </option>
            ))}
          </Select>
          <p className="text-muted-foreground text-xs">
            Cambiar el tipo reemplaza los campos: cada tipo guarda cosas distintas.
          </p>
        </div>
      )}

      <div className="border-border border-t pt-5">
        <SectionFields
          type={type}
          content={content}
          set={set}
          tenantSlug={tenantSlug}
          categories={categories}
          errors={errors}
        />
      </div>

      {/*
        The errors the fields could not claim.

        Every field draws its own message inline, which is where somebody can
        act on it. This is the second half of that: `_form` is what
        `parseSectionContent` uses for an issue with no path, and a key this
        editor does not draw yet - a schema that grew a field - would otherwise
        save nothing and say nothing.
      */}
      {state.status === "error" && Object.keys(errors).length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>
            {errors._form?.[0] ??
              errors.content?.[0] ??
              "Revisa los campos marcados en rojo y vuelve a guardar."}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          {section === undefined ? "Anadir seccion" : "Guardar cambios"}
        </Button>
        {section !== undefined ? (
          <Badge variant="neutral">
            <SectionGlyph type={section.type} className="size-3" />
            {SECTION_LABELS[section.type]}
          </Badge>
        ) : null}
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/*  One section in the page's list                                             */
/* -------------------------------------------------------------------------- */

export function SectionCard({
  tenantSlug,
  pageId,
  section,
  categories,
  index,
  total,
}: {
  tenantSlug: string;
  pageId: string;
  section: AdminSection;
  categories: readonly CategoryChoice[];
  index: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const meta = SECTION_META[section.type];

  return (
    <Card className={cn("overflow-hidden", !section.isVisible && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
          <SectionGlyph type={section.type} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {meta.label}
            {!section.isVisible ? (
              <Badge variant="neutral" className="ml-2">
                Oculta
              </Badge>
            ) : null}
          </p>
          <p className="text-muted-foreground truncate text-xs">{meta.description}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* Reorder. Each is its own form because each is its own write. */}
          <form action={moveSectionAction}>
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="pageId" value={pageId} />
            <input type="hidden" name="sectionId" value={section.id} />
            <input type="hidden" name="direction" value="up" />
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              disabled={index === 0}
              aria-label="Subir seccion"
            >
              <IconChevronUp />
            </Button>
          </form>

          <form action={moveSectionAction}>
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="pageId" value={pageId} />
            <input type="hidden" name="sectionId" value={section.id} />
            <input type="hidden" name="direction" value="down" />
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              disabled={index === total - 1}
              aria-label="Bajar seccion"
            >
              <IconChevronDown />
            </Button>
          </form>

          <form action={toggleSectionVisibilityAction}>
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="pageId" value={pageId} />
            <input type="hidden" name="sectionId" value={section.id} />
            <input type="hidden" name="isVisible" value={String(section.isVisible)} />
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              aria-label={section.isVisible ? "Ocultar seccion" : "Mostrar seccion"}
            >
              {section.isVisible ? <IconEye /> : <IconEyeOff />}
            </Button>
          </form>

          <Button
            type="button"
            variant={open ? "secondary" : "outline"}
            size="sm"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Cerrar" : "Editar"}
          </Button>
        </div>
      </div>

      {open ? (
        <div id={bodyId} className="border-border bg-muted/20 border-t p-4">
          <SectionEditor
            tenantSlug={tenantSlug}
            pageId={pageId}
            section={section}
            categories={categories}
          />

          <div className="border-border mt-5 flex items-center justify-between gap-3 border-t pt-4">
            <p className="text-muted-foreground text-xs">
              Borrar una seccion no se puede deshacer. Si solo quieres que deje de verse, usa el
              ojo.
            </p>
            <DeleteSectionForm tenantSlug={tenantSlug} pageId={pageId} sectionId={section.id} />
          </div>
        </div>
      ) : null}
    </Card>
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
    <form action={deleteSectionAction} className="flex shrink-0 items-center gap-2">
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
        <IconTrash />
        Borrar
      </Button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/*  Adding a new one                                                           */
/* -------------------------------------------------------------------------- */

export function AddSectionPanel({
  tenantSlug,
  pageId,
  categories,
  nextPosition,
}: {
  tenantSlug: string;
  pageId: string;
  categories: readonly CategoryChoice[];
  nextPosition: number;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <IconPlus />
        Anadir seccion
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Anadir seccion</h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
      {/* Remounted on close so the next "Anadir" starts from the template
          rather than from what was half-typed and abandoned. */}
      <SectionEditor
        tenantSlug={tenantSlug}
        pageId={pageId}
        categories={categories}
        position={nextPosition}
        onSaved={() => setOpen(false)}
      />
    </Card>
  );
}
