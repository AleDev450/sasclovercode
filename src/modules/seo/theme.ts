/**
 * A tenant theme, expressed as CSS custom properties.
 *
 * Phase 06 stored the theme and Phase 07 rendered sites that ignored it
 * (KL-708). This is where it finally reaches the page, and HOW it reaches the
 * page is the security-relevant part.
 *
 * Values become custom properties on a `style` attribute of one wrapper
 * element. They are NOT concatenated into a `<style>` block, which is the
 * obvious implementation and the wrong one: a stylesheet built by string
 * concatenation is a stylesheet an author can inject into, and CSS injection is
 * not harmless (`background: url(...)` exfiltrates, and a full-viewport overlay
 * is a workable clickjacking primitive). React serialises a style object by
 * escaping it, so no value can end an attribute or start a rule.
 *
 * Two layers hold the guarantee. The database CHECK constrains every colour to
 * `^#[0-9a-f]{6}$` (Phase 06, AB-606), and the guard below re-checks it here.
 * The second check is not redundant paranoia: this value has crossed PostgREST,
 * a JSON boundary and a type assertion since the CHECK ran, and the cost of
 * verifying a six-character string is nothing.
 *
 * ---------------------------------------------------------------------------
 * WHY A THEME IS NO LONGER JUST THREE COLOURS
 * ---------------------------------------------------------------------------
 *
 * It was, and the result was that every site in the product had the same shape
 * and the same typography in a different palette. A restaurant website is
 * judged in about a second, and what is being judged in that second is type
 * size, white space, the ratio of the photographs and how sharp the corners
 * are - not the hue of the button.
 *
 * So a theme now also names a STYLE: one of a small set of complete design
 * languages (`SITE_STYLES` below), each of which supplies a display face, a
 * vertical rhythm, a photographic ratio, an elevation treatment and the
 * letter-spacing of the small capitalised labels. The style is an enum, its
 * token values are literals in this file, and a tenant cannot author one - so
 * it widens what a site can look like without widening what a site can inject.
 *
 * Colour still comes from the tenant's three columns, and every readable value
 * is still MEASURED against the background rather than assumed. That is what
 * lets `atelier` ship a near-black page without a single hard-coded `text-black`
 * having to be found and fixed.
 */

import type { CSSProperties } from "react";

export interface ThemeValues {
  readonly primaryColor: string;
  readonly accentColor: string;
  readonly backgroundColor: string;
  readonly fontFamily: string;
  readonly borderRadius: string;
  /** Which design language the page is built in. See `SITE_STYLES`. */
  readonly style: string;
}

/**
 * Same defaults as the `tenant_themes` column defaults, which are the "Atelier"
 * theme (migration 20260915120000).
 *
 * They have to match. This is the fallback the renderer uses when the theme row
 * cannot be read, so a drift shows up as a business whose site changes colour
 * for the duration of a database hiccup.
 */
export const THEME_DEFAULTS: ThemeValues = {
  primaryColor: "#e8d3a9",
  accentColor: "#d9a441",
  backgroundColor: "#121214",
  fontFamily: "jost",
  borderRadius: "none",
  style: "atelier",
};

const HEX = /^#[0-9a-f]{6}$/;

/**
 * Font stacks, and what changed about them.
 *
 * These used to be bare family names - `"Lora, Georgia, serif"` - on the
 * argument that downloading a webfont would add a third-party request to every
 * tenant page. The argument was sound and its consequence was not looked at:
 * hardly any visitor has Lora installed, so the stack silently resolved to
 * Georgia, and every theme in the gallery rendered in whatever the operating
 * system felt like.
 *
 * The families are now self-hosted at build time by `next/font/google` (see
 * `modules/seo/fonts.ts`), which is why each entry leads with a
 * `var(--font-...)`: that variable is declared by the class `SITE_FONT_CLASSNAME`
 * puts on the same element. No request leaves for Google, `font-src 'self'`
 * stays untouched, and a business that picks a face gets that face.
 *
 * The three legacy keys are kept unloaded on purpose. Rows written before this
 * change may still hold them, and a site whose font key stopped resolving would
 * fall through to the `system` branch mid-sentence; leaving them here means
 * such a row renders exactly as it did yesterday.
 */
const FONT_STACKS: Record<string, string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  inter: "var(--font-inter), system-ui, -apple-system, 'Segoe UI', sans-serif",
  jost: "var(--font-jost), system-ui, -apple-system, 'Segoe UI', sans-serif",
  "dm-sans": "var(--font-dm-sans), system-ui, -apple-system, 'Segoe UI', sans-serif",
  cormorant: "var(--font-cormorant), 'Cormorant Garamond', Georgia, 'Times New Roman', serif",
  playfair: "var(--font-playfair), 'Playfair Display', Georgia, 'Times New Roman', serif",
  fraunces: "var(--font-fraunces), Fraunces, Georgia, 'Times New Roman', serif",

  /* Legacy keys. Stored by themes that predate the three-theme gallery. */
  poppins: "Poppins, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  lora: "Lora, Georgia, 'Times New Roman', serif",
  roboto: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif",
};

/**
 * Corner radii, in pairs.
 *
 * The second value is for the small things - a badge, a chip, an input - which
 * need a tighter curve than a card or they read as lozenges. Deriving it from
 * the same key rather than storing a second column keeps `none` genuinely sharp
 * everywhere, which is the entire point of the `atelier` look.
 */
const RADII: Record<string, readonly [card: string, chip: string]> = {
  none: ["0px", "0px"],
  sm: ["0.25rem", "0.125rem"],
  md: ["0.5rem", "0.25rem"],
  lg: ["1rem", "0.5rem"],
  full: ["9999px", "9999px"],
};

/**
 * A complete design language, of which a tenant picks one.
 *
 * WHAT BELONGS HERE AND WHAT DOES NOT. Everything here is a decision a
 * restaurant owner cannot make well and should not be asked to make at all:
 * the tracking of an overline, how tall a section breathes, whether a dish
 * photograph is landscape or portrait. Everything a business genuinely owns -
 * its colours, its logo, its words - stays in its own columns.
 *
 * Three of them, not nine, and all three for restaurants. Nine palettes named
 * after moods gave an owner a colour-picking exercise; three finished looks
 * give them a choice between three restaurants.
 */
export interface SiteStyle {
  readonly id: string;
  /** Key into `FONT_STACKS`. Headings only - body type stays the tenant's. */
  readonly displayFont: string;
  readonly displayWeight: string;
  readonly displayTracking: string;
  readonly displayLeading: string;
  /** The small capitalised label that sits above a heading. */
  readonly eyebrowTracking: string;
  readonly eyebrowTransform: "uppercase" | "none";
  /** Vertical breathing room between sections. */
  readonly sectionSpace: string;
  /** How far a card lifts off the page. */
  readonly elevation: "flat" | "soft" | "raised";
  /** The shape of every photograph on the site. */
  readonly mediaRatio: string;
  /** Where a hero puts its words. */
  readonly heroAlign: "left" | "center";
  /**
   * The hero's column track at desktop width, and the shape of its photograph.
   *
   * LAYOUT AS A TOKEN, which needs justifying. Everything else here is a
   * typographic or chromatic value; these two are composition. They are here
   * because the alternative is a `style === "atelier"` branch in the renderer,
   * and that is the seam through which a design system turns into a switch
   * statement: the next style then needs a branch in every component that has
   * one. A single track value keeps the renderer describing ONE layout whose
   * proportions the theme supplies.
   */
  readonly heroColumns: string;
  readonly heroRatio: string;
  /** Extra tracking on body copy. Wide type needs air; a serif does not. */
  readonly bodyTracking: string;
}

export const SITE_STYLES: Record<string, SiteStyle> = {
  /**
   * ALTA COCINA. A tasting menu, a wine list, a room that is mostly dark.
   *
   * Everything here is doing one thing: making the page quiet so the food is
   * loud. Nothing is rounded, nothing casts a shadow, the sections are enormous
   * and the only ornament is the letter-spacing.
   */
  atelier: {
    id: "atelier",
    displayFont: "cormorant",
    // 300 would be more fashionable and unreadable at menu sizes on a phone.
    displayWeight: "400",
    displayTracking: "-0.005em",
    displayLeading: "1.05",
    eyebrowTracking: "0.34em",
    eyebrowTransform: "uppercase",
    sectionSpace: "clamp(4.5rem, 9vw, 9rem)",
    elevation: "flat",
    // Portrait. A plated dish photographs upright, and a column of tall frames
    // is the single strongest "this is expensive" signal in the whole system.
    mediaRatio: "4 / 5",
    heroAlign: "center",
    // One column: the words open the page alone and the photograph follows,
    // wide and quiet, the way a restaurant's own site opens.
    heroColumns: "1fr",
    heroRatio: "16 / 9",
    bodyTracking: "0.015em",
  },

  /**
   * PARRILLA, POLLERIA, CRIOLLO. Fire, generosity, a full table.
   *
   * The opposite instinct to `atelier` and deliberately so: weight instead of
   * air, warm elevation instead of hairlines, wide landscape photography
   * because the subject is a platter and not a plate.
   */
  brasa: {
    id: "brasa",
    displayFont: "fraunces",
    displayWeight: "600",
    displayTracking: "-0.02em",
    displayLeading: "1.02",
    eyebrowTracking: "0.2em",
    eyebrowTransform: "uppercase",
    sectionSpace: "clamp(3.5rem, 6.5vw, 6rem)",
    elevation: "raised",
    mediaRatio: "3 / 2",
    heroAlign: "left",
    heroColumns: "1.05fr 1fr",
    heroRatio: "4 / 3",
    bodyTracking: "0em",
  },

  /**
   * CEVICHERIA, MARISQUERIA, BISTRO DE PUERTO. Light, salt, citrus.
   *
   * The editorial one. An almost-square frame and a high-contrast serif over a
   * neutral grotesk is the grammar of a printed menu, and the generous rhythm
   * keeps it from looking like a brochure.
   */
  marea: {
    id: "marea",
    displayFont: "playfair",
    displayWeight: "500",
    displayTracking: "-0.015em",
    displayLeading: "1.08",
    eyebrowTracking: "0.26em",
    eyebrowTransform: "uppercase",
    sectionSpace: "clamp(4rem, 7.5vw, 7.5rem)",
    elevation: "soft",
    mediaRatio: "1 / 1",
    heroAlign: "left",
    // A tall frame beside the type, which is the proportion of a menu card.
    heroColumns: "1fr 0.85fr",
    heroRatio: "4 / 5",
    bodyTracking: "0.005em",
  },
};

/** The style a row falls back to when its key names nothing. */
export const DEFAULT_STYLE_ID = "atelier";

/** The stored colour if it is one, otherwise the default. Never arbitrary text. */
function safeColor(value: string, fallback: string): string {
  return HEX.test(value) ? value : fallback;
}

/** `#rrggbb` to its three channels. Only ever called on a HEX-validated value. */
function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** WCAG relative luminance. 0 is black, 1 is white. */
function luminance(hex: string): number {
  const linear = channels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }) as [number, number, number];

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG contrast ratio between two colours. 1 is identical, 21 is black on white. */
function contrast(a: string, b: string): number {
  const one = luminance(a);
  const two = luminance(b);
  const [lighter, darker] = one > two ? [one, two] : [two, one];
  return (lighter + 0.05) / (darker + 0.05);
}

/** The near-black this design system uses for text. Never pure #000. */
const INK = "#111827";

/**
 * Black or white, whichever is readable ON `hex`.
 *
 * WHY THIS IS COMPUTED AND NOT STORED. A business picks three colours; it does
 * not pick "the colour of text on top of my button", and asking it to would be
 * asking it to solve a contrast problem it cannot see.
 *
 * WHY IT MEASURES INSTEAD OF THRESHOLDING. It used to be
 * `luminance(hex) > 0.45 ? ink : white`, and 0.45 is far above the point where
 * the two actually cross over - which for WCAG is a luminance near 0.18. Every
 * mid-tone therefore got WHITE text when black would have been far more
 * readable, and mid-tones are exactly what a brand accent is. Measured across
 * the preset gallery the old rule produced accent badges at 2.1:1 to 3.1:1 -
 * all of them below the 4.5:1 floor, on a value the palette was chosen for.
 *
 * Asking which of the two candidates wins, rather than guessing from a
 * constant, also means there is no threshold left to be wrong for a colour
 * nobody anticipated - and a business typing its own hex into the custom editor
 * is precisely that case. It is also what makes `atelier` possible: a champagne
 * button on a near-black page needs an INK label, which no fixed rule that
 * assumed "brand colours are dark" would ever have produced.
 */
function readableOn(hex: string): string {
  return contrast(hex, INK) >= contrast(hex, "#ffffff") ? INK : "#ffffff";
}

/** `rgb(r g b / alpha)` from a hex. For tints that must sit on any background. */
function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

/** `amount` of `b` mixed into `a`, per channel. Both are HEX-validated. */
function mix(a: string, b: string, amount: number): string {
  const one = channels(a);
  const two = channels(b);
  const channel = (index: 0 | 1 | 2): string =>
    Math.round(one[index] * (1 - amount) + two[index] * amount)
      .toString(16)
      .padStart(2, "0");

  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/**
 * The colour of TEXT ON THE PAGE, as opposed to text on a button.
 *
 * WHY IT IS NOT JUST `readableOn(background)`. That returns one of two
 * constants - a cool slate `#111827` or pure white - and a cool slate is wrong
 * on warm paper. `brasa` sets a bone-coloured page and every word on it came
 * out faintly blue, which is the kind of thing nobody can name and everybody
 * can see: printed matter does not mix a warm stock with a cold ink.
 *
 * So a tenth of the page is mixed into the ink. On bone the near-black warms;
 * on the near-black `atelier` page the white cools to the colour of the room
 * instead of glaring; on a white page the mix changes almost nothing, which is
 * correct, because there is nothing to agree with.
 *
 * It costs contrast and the cost is negligible - a tenth of the way toward a
 * colour that was already the maximum-distance choice leaves every preset in
 * this repository between 13:1 and 17:1, against a 4.5:1 floor that
 * `seo-theme.test.ts` re-measures. `readableOn` itself is left alone, because a
 * LABEL on a brand fill has no paper to agree with and wants the most readable
 * of the two, full stop.
 */
function pageInk(background: string): string {
  return mix(readableOn(background), background, 0.1);
}

/**
 * The shadow for a card, given how much the style wants it to lift.
 *
 * A DARK PAGE GETS NO SHADOW, and that is not a shortcut. A drop shadow works
 * by darkening what is behind it; on a near-black background there is nothing
 * left to darken, so the same CSS that lifts a card off white does literally
 * nothing on `atelier` while still costing a paint. Dark interfaces separate
 * surfaces by making them LIGHTER, which is what `--site-surface` already does:
 * it is a tint of the foreground, and on a dark page the foreground is white.
 *
 * So the elevation intent survives on light backgrounds and is answered by the
 * surface lift on dark ones, and neither case needs the renderer to know which
 * it is in.
 */
function shadowFor(elevation: SiteStyle["elevation"], onDark: boolean): [string, string] {
  if (elevation === "flat" || onDark) return ["none", "none"];

  return elevation === "raised"
    ? [
        "0 1px 2px rgb(0 0 0 / 0.05), 0 12px 28px -16px rgb(0 0 0 / 0.28)",
        "0 2px 4px rgb(0 0 0 / 0.06), 0 28px 56px -24px rgb(0 0 0 / 0.36)",
      ]
    : [
        "0 1px 2px rgb(0 0 0 / 0.03), 0 10px 30px -22px rgb(0 0 0 / 0.22)",
        "0 2px 4px rgb(0 0 0 / 0.04), 0 22px 48px -26px rgb(0 0 0 / 0.3)",
      ];
}

/**
 * The custom properties a tenant page sets on its wrapper element.
 *
 * Prefixed `--site-` so they cannot collide with the design tokens the
 * dashboard uses: a tenant theme must never repaint the platform's own UI.
 *
 * WHAT IS STORED AND WHAT IS DERIVED. A theme row holds three colours, a body
 * font, a radius and a style key. A page needs far more than that to look
 * finished - a display face, body text, secondary text, hairlines, a panel
 * tint, a scrim over a photograph, a readable label on top of each brand
 * colour, a vertical rhythm - and every one of those is a function of the six.
 *
 * Deriving them rather than storing them is what makes ANY palette safe. When
 * the renderer hard-codes `text-black/60` it is betting that every business
 * picks a light background; when it uses `--site-muted` the bet disappears,
 * because a business that picks a dark background gets light text without
 * anybody having thought about that case.
 */
export function themeCssVariables(theme: ThemeValues): CSSProperties {
  const primary = safeColor(theme.primaryColor, THEME_DEFAULTS.primaryColor);
  const accent = safeColor(theme.accentColor, THEME_DEFAULTS.accentColor);
  const background = safeColor(theme.backgroundColor, THEME_DEFAULTS.backgroundColor);
  const style = SITE_STYLES[theme.style] ?? SITE_STYLES[DEFAULT_STYLE_ID]!;

  // Everything readable is measured against the BACKGROUND, so a dark theme
  // flips the whole page rather than half of it.
  const foreground = pageInk(background);
  const onDark = readableOn(background) === "#ffffff";

  const [radius, radiusChip] = RADII[theme.borderRadius] ?? RADII.md!;
  const [shadow, shadowLifted] = shadowFor(style.elevation, onDark);

  const variables: Record<string, string> = {
    "--site-primary": primary,
    "--site-accent": accent,
    "--site-background": background,
    "--site-font": FONT_STACKS[theme.fontFamily] ?? FONT_STACKS.system!,
    "--site-radius": radius,
    "--site-radius-chip": radiusChip,

    /** Text that sits on `--site-primary` / `--site-accent`. */
    "--site-on-primary": readableOn(primary),
    "--site-on-accent": readableOn(accent),

    /** Body copy, secondary copy, and the faintest legible step. */
    "--site-foreground": foreground,
    "--site-muted": withAlpha(foreground, 0.65),
    "--site-subtle": withAlpha(foreground, 0.45),

    /** Hairlines and panels, as a tint of the text colour so they always show. */
    "--site-border": withAlpha(foreground, 0.12),
    "--site-border-strong": withAlpha(foreground, 0.22),
    "--site-surface": withAlpha(foreground, 0.035),
    "--site-surface-strong": withAlpha(foreground, 0.07),

    /** Brand tints, for section bands and badges. */
    "--site-primary-soft": withAlpha(primary, 0.1),
    "--site-primary-line": withAlpha(primary, 0.32),
    "--site-accent-soft": withAlpha(accent, 0.12),

    /* ------------------------------------------------------------- style */

    /** Headings. The body face stays whatever the business chose. */
    "--site-display-font": FONT_STACKS[style.displayFont] ?? FONT_STACKS.system!,
    "--site-display-weight": style.displayWeight,
    "--site-display-tracking": style.displayTracking,
    "--site-display-leading": style.displayLeading,
    "--site-body-tracking": style.bodyTracking,

    /** The overline above a heading: "Nuestra carta", "Desde 1998". */
    "--site-eyebrow-tracking": style.eyebrowTracking,
    "--site-eyebrow-transform": style.eyebrowTransform,

    "--site-section-space": style.sectionSpace,
    "--site-media-ratio": style.mediaRatio,
    "--site-hero-align": style.heroAlign,
    "--site-hero-items": style.heroAlign === "center" ? "center" : "flex-start",
    "--site-hero-columns": style.heroColumns,
    "--site-hero-ratio": style.heroRatio,

    "--site-shadow": shadow,
    "--site-shadow-lifted": shadowLifted,

    /**
     * The fade at the foot of a photograph, so type can sit on it.
     *
     * Built from the tenant's own background, which is what keeps an image
     * from ending in a hard edge on a dark theme and in a grey haze on a light
     * one. The colour inside it went through `safeColor`, so the gradient is
     * assembled from a value that is provably six hex digits.
     */
    "--site-scrim": `linear-gradient(to top, ${withAlpha(background, 0.92)} 0%, ${withAlpha(
      background,
      0.55,
    )} 38%, ${withAlpha(background, 0)} 78%)`,

    /**
     * The wash behind the hero.
     *
     * A GRADIENT, AND BUILT FROM THE ACCENT. It was `--site-primary-soft`: one
     * flat slab of the brand colour at 10%, which ended in a hard horizontal
     * seam across the page and - because a primary is usually a very dark,
     * desaturated colour - resolved to grey. Marea's deep petrol over warm
     * linen came out the colour of a car park.
     *
     * The accent is the lighter, more saturated of the two by construction: it
     * is what a business picks for badges. At 12% fading to nothing it reads as
     * the brand rather than as a panel, and having no bottom edge is what stops
     * the hero looking like a box the page was pasted into.
     *
     * The stop at zero is written with the background's own channels rather
     * than the keyword `transparent`, which some engines interpolate through
     * transparent BLACK and turn into a grey smear on a light page.
     */
    "--site-hero-wash": `linear-gradient(180deg, ${withAlpha(accent, 0.12)} 0%, ${withAlpha(
      accent,
      0.04,
    )} 52%, ${withAlpha(background, 0)} 100%)`,
  };

  // The cast is to `CSSProperties`, which has no index signature for custom
  // properties. React accepts them at runtime; the type simply predates them.
  return variables as CSSProperties;
}
