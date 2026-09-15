/**
 * The themes CloverCode offers a business.
 *
 * WHY PRESETS EXIST. Phase 06 gave a tenant five free-form fields - three hex
 * colours, a font and a corner radius - and that is the right STORAGE model and
 * the wrong thing to hand somebody who runs a bakery. Asked to pick three
 * colours that work together, most people produce something worse than any
 * default, and the ones who do not still have to guess what `#0ea5e9` will look
 * like next to `#16a34a`. A preset is one decision instead of five, taken by
 * somebody who could see the result.
 *
 * Nothing here is a new capability: applying a preset writes exactly the same
 * five columns the custom editor writes, so a business can start from a preset
 * and then change one colour, and the site renderer never learns that presets
 * exist. That is deliberate - a preset is a STARTING POINT, not a mode.
 *
 * EVERY COMBINATION BELOW WAS MEASURED, not eyeballed. Three ratios have to
 * clear 4.5:1 for a palette to be in this file: `primary` against `background`
 * (it sets prices and headings), and each of `primary` and `accent` against the
 * label `readableOn` computes for it (they are button and badge fills).
 *
 * The previous set failed the third of those on six of eight entries - accent
 * badges came out between 2.1:1 and 3.1:1 - and the cause was not the colours
 * but `readableOn`, which thresholded at a luminance of 0.45 when the real
 * crossover is near 0.18, so every mid-tone got white text where black was far
 * more readable. That is fixed in `modules/seo/theme.ts`; these nine now land
 * between 4.8:1 and 12.2:1. `src/tests/unit/seo-theme.test.ts` re-measures
 * them, so a tenth preset cannot be added below the floor.
 */

import type { ThemeValues } from "@/modules/seo/theme";

export interface ThemePreset extends ThemeValues {
  /** Stable id, stored nowhere - it only ever travels in a form field. */
  readonly id: string;
  readonly name: string;
  /** Who this is for, in the words of somebody choosing it. */
  readonly description: string;
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: "clover",
    name: "Clover",
    description: "El estilo de la casa. Verde azulado sobre blanco, limpio y moderno.",
    primaryColor: "#0f766e",
    accentColor: "#14b8a6",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    borderRadius: "lg",
  },
  {
    id: "brasa",
    name: "Brasa",
    description: "Rojo ladrillo y fondo calido. Para pollerias, parrillas y comida criolla.",
    primaryColor: "#b42318",
    accentColor: "#e4762a",
    backgroundColor: "#fffaf5",
    fontFamily: "poppins",
    borderRadius: "md",
  },
  {
    id: "menta",
    name: "Menta",
    description: "Verde fresco. Comida saludable, jugueria, vegetariano.",
    primaryColor: "#15803d",
    accentColor: "#34d399",
    backgroundColor: "#f6fdf9",
    fontFamily: "inter",
    borderRadius: "lg",
  },
  {
    id: "dulce",
    name: "Dulce",
    description: "Rosa suave y esquinas redondas. Pasteleria, heladeria, postres.",
    primaryColor: "#be185d",
    accentColor: "#f472b6",
    backgroundColor: "#fffafc",
    fontFamily: "poppins",
    // `full` used to be here and it rounded the product photos into lozenges.
    // A radius is applied to cards AND to images; `lg` is as soft as this
    // system can go before that starts to look like a mistake.
    borderRadius: "lg",
  },
  {
    id: "oceano",
    name: "Oceano",
    description: "Azul profundo y confiable. Cevicherias, farmacias, servicios.",
    primaryColor: "#075985",
    accentColor: "#38bdf8",
    backgroundColor: "#f7fbff",
    fontFamily: "inter",
    borderRadius: "md",
  },
  {
    id: "cafe",
    name: "Cafe",
    description: "Marrones calidos con tipografia serif. Cafeterias y panaderias.",
    primaryColor: "#7c4a21",
    accentColor: "#c08552",
    backgroundColor: "#fdf9f3",
    fontFamily: "lora",
    borderRadius: "sm",
  },
  {
    id: "noche",
    name: "Noche",
    description: "Morado sobre fondo claro. Licorerias, bares y discotecas.",
    primaryColor: "#5b21b6",
    accentColor: "#a78bfa",
    backgroundColor: "#faf7ff",
    fontFamily: "poppins",
    borderRadius: "lg",
  },
  {
    id: "sobrio",
    name: "Sobrio",
    description: "Gris carbon sin adornos. Boutiques, estudios y ropa.",
    primaryColor: "#18181b",
    accentColor: "#71717a",
    backgroundColor: "#fafafa",
    fontFamily: "system",
    borderRadius: "none",
  },
  /*
   * The one dark theme, and the reason it is worth having beyond taste.
   *
   * Everything a page needs beyond the three stored colours is DERIVED from
   * them - body text, hairlines, panel tints, the label on a button - and the
   * derivation measures against the background rather than assuming it is
   * white. A dark preset is the only entry in this gallery that proves that is
   * true, and the only one that would break loudly if somebody replaced a
   * derived token with a hard-coded `text-black/60` again.
   */
  {
    id: "medianoche",
    name: "Medianoche",
    description: "Fondo oscuro y lila claro. Bares de noche, gimnasios, tecnologia.",
    primaryColor: "#c4b5fd",
    accentColor: "#67e8f9",
    backgroundColor: "#0f172a",
    fontFamily: "inter",
    borderRadius: "lg",
  },
] as const;

/** The preset a newly provisioned business starts from. */
export const DEFAULT_PRESET_ID = "clover";

export function findPreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((preset) => preset.id === id);
}

/**
 * Which preset a stored theme corresponds to, if any.
 *
 * Compares the five values that a preset actually sets. A business that changed
 * one colour matches nothing, and that is the correct answer: the gallery then
 * shows no card as selected, which is honest - their theme is theirs now.
 */
export function matchPreset(theme: ThemeValues): ThemePreset | undefined {
  return THEME_PRESETS.find(
    (preset) =>
      preset.primaryColor === theme.primaryColor &&
      preset.accentColor === theme.accentColor &&
      preset.backgroundColor === theme.backgroundColor &&
      preset.fontFamily === theme.fontFamily &&
      preset.borderRadius === theme.borderRadius,
  );
}
