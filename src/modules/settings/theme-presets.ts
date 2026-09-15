/**
 * The three restaurants CloverCode knows how to be.
 *
 * WHY THREE AND NOT NINE. The gallery used to hold nine presets named after
 * moods - Menta, Dulce, Noche, Sobrio - which between them covered bakeries,
 * pharmacies, gyms, boutiques and nightclubs. Every one of them was the same
 * page in a different colour: same system font, same spacing, same square
 * photographs, same everything that a visitor actually reads a restaurant site
 * by. Nine of those is not nine choices, it is one design and a colour picker,
 * and offering it as "elige tu tema" oversold it badly.
 *
 * Three is what you can actually make GOOD. Each of these is a finished look -
 * its own display face, its own vertical rhythm, its own photographic ratio,
 * its own shape language - and the three are far enough apart that an owner
 * recognises their own restaurant in one of them within a second. That
 * recognition is the whole job of this screen.
 *
 * WHY ALL THREE ARE RESTAURANTS. Because that is who buys this. A theme that
 * tries to also serve a pharmacy serves neither, and the product already has a
 * fine-tuning form for a business that is something else and knows its own
 * brand colours.
 *
 * ---------------------------------------------------------------------------
 *
 * HOW A PRESET REACHES A PAGE. Applying one writes exactly the same six columns
 * the custom editor writes, so a business can start from a preset and then
 * change one colour, and the site renderer never learns that presets exist.
 * That is deliberate - a preset is a STARTING POINT, not a mode.
 *
 * EVERY COMBINATION BELOW WAS MEASURED, not eyeballed. Four ratios have to
 * clear 4.5:1: `primary` against `background` (it sets prices and headings),
 * `accent` against `background`, and each of `primary` and `accent` against the
 * label `readableOn` computes for it (they are button and badge fills). These
 * three land between 4.7:1 and 18.7:1, and `src/tests/unit/seo-theme.test.ts`
 * re-measures them from the same function the renderer uses, so a fourth preset
 * cannot be added below the floor.
 */

import type { ThemeValues } from "@/modules/seo/theme";

export interface ThemePreset extends ThemeValues {
  /** Stable id, stored as `tenant_themes.style` and travelling in form fields. */
  readonly id: string;
  readonly name: string;
  /** The kind of restaurant this is, in the words of the person choosing. */
  readonly tagline: string;
  /** Who this is for, and what it will do to their page. */
  readonly description: string;
  /** What an operator is actually buying, for the super-admin picker. */
  readonly traits: readonly string[];
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  /*
   * The flagship, and the default a new business is provisioned on.
   *
   * It is also the only dark theme, and that is worth more than taste. Every
   * `--site-*` value beyond the three stored colours is DERIVED from them, and
   * the derivation measures against the background rather than assuming it is
   * white. A dark theme in daily use is the thing that would break loudly if
   * somebody replaced a derived token with a hard-coded `text-black/60` again.
   */
  {
    id: "atelier",
    name: "Atelier",
    tagline: "Alta cocina",
    description:
      "Carta de autor sobre fondo negro, tipografia serif y foto vertical. Para menus de degustacion, barras de autor y cocina de nivel.",
    traits: ["Fondo oscuro", "Serif Cormorant", "Esquinas rectas", "Foto vertical"],
    primaryColor: "#e8d3a9",
    accentColor: "#d9a441",
    backgroundColor: "#121214",
    fontFamily: "jost",
    borderRadius: "none",
    style: "atelier",
  },

  {
    id: "brasa",
    name: "Brasa",
    tagline: "Parrilla y criollo",
    description:
      "Rojo ceniza sobre hueso, titulares con peso y foto ancha. Para parrillas, pollerias, chicharronerias y comida criolla.",
    traits: ["Fondo hueso", "Serif Fraunces", "Tarjetas con relieve", "Foto panoramica"],
    primaryColor: "#7a2718",
    accentColor: "#b45309",
    backgroundColor: "#fdf7f0",
    fontFamily: "inter",
    borderRadius: "sm",
    style: "brasa",
  },

  {
    id: "marea",
    name: "Marea",
    tagline: "Cevicheria y cocina marina",
    description:
      "Azul profundo y rocoto sobre lino, con aire de carta impresa. Para cevicherias, marisquerias y bistros de puerto.",
    traits: ["Fondo lino", "Serif Playfair", "Esquinas suaves", "Foto cuadrada"],
    primaryColor: "#0b3d4f",
    accentColor: "#b1462f",
    backgroundColor: "#f6f4ef",
    fontFamily: "dm-sans",
    borderRadius: "lg",
    style: "marea",
  },
] as const;

/** The preset a newly provisioned business starts from. */
export const DEFAULT_PRESET_ID = "atelier";

export function findPreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((preset) => preset.id === id);
}

/**
 * Which preset a stored theme corresponds to, if any.
 *
 * Compares the six values a preset actually sets. A business that changed one
 * colour matches nothing, and that is the correct answer: the gallery then
 * shows no card as selected, which is honest - their theme is theirs now.
 */
export function matchPreset(theme: ThemeValues): ThemePreset | undefined {
  return THEME_PRESETS.find(
    (preset) =>
      preset.primaryColor === theme.primaryColor &&
      preset.accentColor === theme.accentColor &&
      preset.backgroundColor === theme.backgroundColor &&
      preset.fontFamily === theme.fontFamily &&
      preset.borderRadius === theme.borderRadius &&
      preset.style === theme.style,
  );
}
