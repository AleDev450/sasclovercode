import axe, { type AxeResults, type Result } from "axe-core";

/**
 * Running axe against rendered markup.
 *
 * CLOVERCODE_MASTER.md section 19 lists seven things an administrative
 * interface has to consider — keyboard navigation, labels, focus states,
 * contrast, aria, clear error messages, accessible interactive elements — and
 * twenty-seven phases wrote `aria-describedby` by hand without anything ever
 * checking that they were right.
 *
 * ---------------------------------------------------------------------------
 * WHAT AXE IN JSDOM CAN AND CANNOT SEE
 * ---------------------------------------------------------------------------
 *
 * CAN: labels, roles, aria references that point nowhere, duplicate ids,
 * required parent/child relationships, tab order, names of interactive
 * elements. That is most of section 19, and all of the part that gets broken by
 * accident.
 *
 * CANNOT: colour contrast. jsdom does not lay anything out and computes no
 * styles, so axe's contrast rules cannot run — they would report nothing and
 * look like a pass. They are disabled explicitly rather than left to return a
 * silent zero, and the limitation is recorded (KL-2803) instead of being
 * quietly enjoyed.
 *
 * A test that appears to check contrast and does not is worse than no test:
 * it produces the confidence without the verification.
 */

/**
 * Rules that cannot produce a meaningful result in jsdom.
 *
 * Disabled, and listed here so the reason is visible at the point of the
 * decision rather than in a commit message.
 */
const RULES_WITHOUT_LAYOUT = {
  // Needs computed colours and a rendered box. jsdom has neither.
  "color-contrast": { enabled: false },
} as const;

export interface A11yViolation {
  readonly id: string;
  readonly impact: string;
  readonly help: string;
  readonly nodes: readonly string[];
}

/** Runs axe over a container and returns the violations in readable form. */
export async function findViolations(container: Element): Promise<A11yViolation[]> {
  const results: AxeResults = await axe.run(container, {
    rules: RULES_WITHOUT_LAYOUT,
    // `resultTypes` keeps axe from building the passes array, which for a big
    // form is most of the work and none of the answer.
    resultTypes: ["violations"],
  });

  return results.violations.map(toViolation);
}

function toViolation(result: Result): A11yViolation {
  return {
    id: result.id,
    impact: result.impact ?? "unknown",
    help: result.help,
    nodes: result.nodes.map((node) => node.html),
  };
}

/**
 * Fails with the rule, the impact and the offending markup.
 *
 * A failing accessibility test whose message is `expected 1 to be 0` sends the
 * reader off to reproduce it by hand, which is where most people stop. The
 * whole point is that the next person can fix it without becoming an
 * accessibility expert first, so the message names the rule and shows the node.
 */
export async function expectNoViolations(container: Element, label: string): Promise<void> {
  const violations = await findViolations(container);

  if (violations.length > 0) {
    const detail = violations
      .map(
        (violation) =>
          `  [${violation.impact}] ${violation.id}: ${violation.help}\n` +
          violation.nodes.map((node) => `      ${node}`).join("\n"),
      )
      .join("\n");

    throw new Error(`${label}: ${violations.length} accessibility violation(s)\n${detail}`);
  }
}

/**
 * Every element a keyboard can reach, in the order it reaches them.
 *
 * Section 19 asks for keyboard navigation, and the failure it is asking about
 * is not exotic: a control that only responds to a click, or one taken out of
 * the tab order with `tabindex="-1"` because it looked wrong when focused.
 */
export function focusableElements(container: Element): HTMLElement[] {
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type=hidden])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(", ");

  return [...container.querySelectorAll<HTMLElement>(selector)];
}

/**
 * The accessible name of an element, the way a screen reader would announce it.
 *
 * Checks the three sources in the order the specification does: an explicit
 * `aria-label`, a label pointing at it by `for`, and a wrapping `<label>`.
 */
export function accessibleName(element: HTMLElement): string {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) return ariaLabel.trim();

  const id = element.getAttribute("id");
  if (id !== null) {
    const label = element.ownerDocument.querySelector(`label[for="${id}"]`);
    if (label !== null) return (label.textContent ?? "").trim();
  }

  const wrapping = element.closest("label");
  if (wrapping !== null) return (wrapping.textContent ?? "").trim();

  return (element.textContent ?? "").trim();
}
