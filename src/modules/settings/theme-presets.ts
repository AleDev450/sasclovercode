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
 * EVERY COMBINATION BELOW WAS CHECKED FOR CONTRAST. `primary` is used for
 * buttons with white text and for headings on `background`, so each one clears
 * 4.5:1 against white; `background` stays light enough for near-black body
 * text. A preset that looked good and failed that check is not in this file.
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
    description: "El estilo de la casa. Turquesa sobre blanco, limpio y moderno.",
    primaryColor: "#0e7c81",
    accentColor: "#09b3ba",
    backgroundColor: "#ffffff",
    fontFamily: "inter",
    borderRadius: "lg",
  },
  {
    id: "brasa",
    name: "Brasa",
    description: "Rojo intenso y fondo calido. Para pollerias, parrillas y comida criolla.",
    primaryColor: "#b91c1c",
    accentColor: "#ea580c",
    backgroundColor: "#fffbf7",
    fontFamily: "poppins",
    borderRadius: "md",
  },
  {
    id: "menta",
    name: "Menta",
    description: "Verde fresco. Comida saludable, jugueria, vegetariano.",
    primaryColor: "#15803d",
    accentColor: "#22c55e",
    backgroundColor: "#f7fdf9",
    fontFamily: "inter",
    borderRadius: "lg",
  },
  {
    id: "dulce",
    name: "Dulce",
    description: "Rosa suave y esquinas redondas. Pasteleria, heladeria, postres.",
    primaryColor: "#be185d",
    accentColor: "#ec4899",
    backgroundColor: "#fff7fb",
    fontFamily: "poppins",
    borderRadius: "full",
  },
  {
    id: "oceano",
    name: "Oceano",
    description: "Azul profundo y confiable. Cevicherias, farmacias, servicios.",
    primaryColor: "#0369a1",
    accentColor: "#0ea5e9",
    backgroundColor: "#f8fbfe",
    fontFamily: "inter",
    borderRadius: "md",
  },
  {
    id: "cafe",
    name: "Cafe",
    description: "Marrones calidos con tipografia serif. Cafeterias y panaderias.",
    primaryColor: "#78350f",
    accentColor: "#b45309",
    backgroundColor: "#fdfaf5",
    fontFamily: "lora",
    borderRadius: "sm",
  },
  {
    id: "noche",
    name: "Noche",
    description: "Morado sobre fondo claro. Licorerias, bares y discotecas.",
    primaryColor: "#6d28d9",
    accentColor: "#a855f7",
    backgroundColor: "#faf8ff",
    fontFamily: "poppins",
    borderRadius: "lg",
  },
  {
    id: "sobrio",
    name: "Sobrio",
    description: "Gris carbon sin adornos. Boutiques, estudios y ropa.",
    primaryColor: "#1f2937",
    accentColor: "#4b5563",
    backgroundColor: "#ffffff",
    fontFamily: "system",
    borderRadius: "none",
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
