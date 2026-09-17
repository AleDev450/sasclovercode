/**
 * Turning an existing home page into the restaurant structure, as a plan.
 *
 * WHY A PLAN AND NOT A FUNCTION THAT WRITES. Two callers apply it: the
 * "Crear portada de restaurante" button (a Server Action, under the owner's own
 * permissions) and `scripts/apply-storefront-home.mjs` (the operator, for every
 * business at once). They must do exactly the same thing, and a pure plan is
 * the one piece both can share and a unit test can pin.
 *
 * WHAT IT NEVER DOES: delete. A business built its home page on purpose. The
 * slider, the shortcuts and "Los mas pedidos" go on TOP; the old sections they
 * replace - the hero (the slider is the new cover) and the product lists (the
 * bestsellers and the menu page cover them) - are HIDDEN, and one click on the
 * eye in Paginas brings any of them back. Everything else stays where it was,
 * one step lower.
 *
 * No imports, on purpose: the ops script loads this file with Node's own type
 * stripping, which cannot resolve the `@/` alias.
 */

/** The Sugu Rolls home, top to bottom. */
export const HOME_STRUCTURE = ["slider", "shortcuts", "bestsellers"] as const;

/** Old section types the new structure replaces, hidden rather than removed. */
export const REPLACED_BY_STRUCTURE = ["hero", "products"] as const;

export interface ExistingSection {
  readonly id: string;
  readonly type: string;
  readonly position: number;
  readonly isVisible: boolean;
}

export interface HomeUpgradePlan {
  /** True when the page already has any of the three: nothing to do. */
  readonly alreadyApplied: boolean;
  readonly insert: readonly { type: (typeof HOME_STRUCTURE)[number]; position: number }[];
  /** New positions for the sections that stay, in their existing order. */
  readonly move: readonly { id: string; position: number }[];
  /** Ids to hide. */
  readonly hide: readonly string[];
}

/** The position ceiling of `page_sections_position_range`. */
const MAX_POSITION = 1000;

export function planHomeUpgrade(existing: readonly ExistingSection[]): HomeUpgradePlan {
  const structure: readonly string[] = HOME_STRUCTURE;
  const replaced: readonly string[] = REPLACED_BY_STRUCTURE;

  if (existing.some((section) => structure.includes(section.type))) {
    return { alreadyApplied: true, insert: [], move: [], hide: [] };
  }

  const ordered = [...existing].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  return {
    alreadyApplied: false,
    insert: HOME_STRUCTURE.map((type, position) => ({ type, position })),
    move: ordered
      .map((section, index) => ({
        id: section.id,
        position: Math.min(MAX_POSITION, HOME_STRUCTURE.length + index),
      }))
      .filter((move, index) => move.position !== ordered[index]!.position),
    hide: ordered
      .filter((section) => section.isVisible && replaced.includes(section.type))
      .map((section) => section.id),
  };
}
