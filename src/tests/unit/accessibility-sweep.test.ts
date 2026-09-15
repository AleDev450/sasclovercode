import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * TEST-2813 to TEST-2815 — section 19, swept over the whole repository.
 *
 * The component tests check the markup that a test renders. This checks the
 * markup that exists, in all 71 form components across 20 modules, because the
 * failure section 19 is warning about is not subtle design — it is one input
 * somebody added at the end of a long form without a label.
 *
 * Static, so it cannot see everything a rendered test can. What it can see is
 * exactly the omission that gets made most often, in the places no test renders.
 */

const ROOT = process.cwd();

async function collectFiles(dir: string, match: RegExp): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(full, match)));
    else if (match.test(entry.name)) files.push(full);
  }
  return files;
}

function relative(file: string): string {
  return file.replace(ROOT, "").replace(/\\/g, "/");
}

/**
 * Source with its comments removed.
 *
 * WHY THIS IS NEEDED. This sweep reads markup as text, and a component whose
 * documentation explains why it is NOT using a `<select>` was reported as a
 * `<select>` with no label. The prose was right and the sweep was measuring the
 * wrong thing - the guarantee is about controls that render, not about the word
 * appearing in a file.
 *
 * The same trap was found and closed once already, in `cms-sections.test.ts`,
 * where the renderer's own header names `dangerouslySetInnerHTML` in order to
 * say it is never used. Stripping first is the fix that worked there.
 *
 * It can only ever produce FALSE NEGATIVES for controls that exist solely
 * inside a comment, which do not render and cannot be unlabelled.
 */
function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split("\n")
    .map((line) => {
      // `(?<!:)` so an `https://` inside an attribute is not mistaken for the
      // start of a comment, which would cut the line - and with it a `>` the
      // tag matcher below depends on.
      const index = line.search(/(?<!:)\/\//);
      return index === -1 ? line : line.slice(0, index);
    })
    .join("\n");
}

/** Every `<input`, `<select` and `<textarea` opening tag, with its attributes. */
function controlTags(source: string): { tag: string; kind: string }[] {
  const found: { tag: string; kind: string }[] = [];
  for (const match of stripComments(source).matchAll(/<(input|select|textarea)\b([^>]*)>/gs)) {
    found.push({ kind: match[1] ?? "", tag: match[0] });
  }
  return found;
}

describe("labels (TEST-2813, TEST-2815)", () => {
  it("gives every visible form control a name", async () => {
    const files = await collectFiles(join(ROOT, "src"), /\.tsx$/);
    expect(files.length).toBeGreaterThan(0);

    const unlabelled: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");

      /*
       * The UI primitives are excluded, and only they.
       *
       * `components/ui/input.tsx` renders an `<input>` that receives its id and
       * its label from whoever uses it - a primitive cannot name itself. What
       * guarantees it is used correctly is TEST-2803, which renders an Input
       * with no label and asserts axe catches it.
       *
       * Everything else in the repository has to name its own controls.
       */
      if (relative(file).startsWith("/src/components/ui/")) continue;

      for (const { tag, kind } of controlTags(source)) {
        // A hidden input carries a value, not a question. There is nothing for
        // a person to read and nothing for a screen reader to announce.
        if (/type=["']hidden["']/.test(tag)) continue;

        // A checkbox in this codebase is wrapped by its own <label>, which is
        // the association; there is no `id` to point `for` at.
        const isWrappedCheckbox = /type=["'](checkbox|radio)["']/.test(tag);

        const named =
          /aria-label[=\s]/.test(tag) ||
          /aria-labelledby[=\s]/.test(tag) ||
          // `id={name}` plus a <Label htmlFor={name}> in the same component.
          (/\bid=/.test(tag) && /htmlFor=/.test(source)) ||
          isWrappedCheckbox;

        if (!named) unlabelled.push(`${relative(file)} → <${kind}>`);
      }
    }

    expect(unlabelled, `form controls with no accessible name:\n${unlabelled.join("\n")}`).toEqual(
      [],
    );
  });

  it("pairs every htmlFor with an id in the same component (TEST-2815)", async () => {
    const files = await collectFiles(join(ROOT, "src"), /\.tsx$/);
    const dangling: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");

      /*
       * Two shapes, and telling them apart is the whole difficulty.
       *
       *   htmlFor="precio"   a LITERAL id. The same literal must appear as an
       *                      id somewhere in the component.
       *   htmlFor={name}     an EXPRESSION. `name` is a variable, not an id, so
       *                      what has to match is `id={name}` — the same
       *                      expression, not the same text as a string.
       *
       * An earlier version of this rule conflated them and reported six
       * perfectly correct components, which is the failure mode that gets a
       * test deleted rather than fixed.
       *
       * A label pointing at nothing is a label a screen reader never reads out
       * with its field, and it looks completely correct on screen.
       *
       * `inputId` counts as establishing the id: when the control is a
       * component rather than an element, this codebase passes the id down as
       * that prop and the component puts it on the real input. A static sweep
       * cannot follow a prop across files, so it trusts the convention — and
       * the convention is enforced by the component tests, which render the
       * thing and ask axe.
       */
      for (const match of source.matchAll(/htmlFor=(?:"([\w-]+)"|\{(\w+)\})/g)) {
        const literal = match[1];
        const expression = match[2];

        const accepted =
          literal !== undefined
            ? [`id="${literal}"`, `id={"${literal}"}`, `inputId="${literal}"`]
            : [`id={${expression}}`, `inputId={${expression}}`];

        if (!accepted.some((form) => source.includes(form))) {
          dangling.push(`${relative(file)} → htmlFor=${literal ?? `{${expression}}`}`);
        }
      }
    }

    expect(dangling, `labels pointing at no control:\n${dangling.join("\n")}`).toEqual([]);
  });
});

/**
 * Where `tabindex="-1"` is deliberate, and why.
 *
 * This rule used to be a flat zero, with the note that legitimate uses exist
 * but none of them were in this codebase yet. One now is: the honeypot on the
 * public contact form is a field a person must NOT be able to reach, because
 * reaching it is the signal that the submitter is a script. Taking it out of
 * the tab order is the accessibility-correct behaviour rather than an exception
 * to it — a keyboard user tabbing into an invisible input they cannot see is
 * precisely the bug this prevents.
 *
 * Keyed by path, so a second file cannot inherit the exemption silently.
 */
const REVIEWED_UNFOCUSABLE: Readonly<Record<string, string>> = {
  "/src/modules/marketing/components/contact-form.tsx":
    "honeypot field: unreachable by design, paired with aria-hidden",
};

describe("keyboard reachability (TEST-2814)", () => {
  it("takes nothing interactive out of the tab order", async () => {
    const files = await collectFiles(join(ROOT, "src"), /\.tsx$/);
    const removed: string[] = [];

    for (const file of files) {
      if (relative(file) in REVIEWED_UNFOCUSABLE) continue;

      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/tabIndex=\{?-1\}?/g)) {
        removed.push(`${relative(file)} → ${match[0]}`);
      }
    }

    // `tabindex="-1"` has legitimate uses — a container that receives focus
    // programmatically, a field nothing should focus at all — and each one that
    // exists here is named above with its reason.
    expect(removed, `elements removed from the tab order:\n${removed.join("\n")}`).toEqual([]);
  });

  it("keeps every tab-order exemption pointing at a file that still exists", async () => {
    // An exemption for a deleted file becomes a hole nobody notices the day
    // somebody recreates the path.
    const files = (await collectFiles(join(ROOT, "src"), /\.tsx$/)).map(relative);

    for (const path of Object.keys(REVIEWED_UNFOCUSABLE)) {
      expect(files, `${path} is exempted but no longer exists`).toContain(path);
    }
  });

  it("uses real buttons rather than clickable divs", async () => {
    const files = await collectFiles(join(ROOT, "src"), /\.tsx$/);
    const fake: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      // A <div onClick> is invisible to a keyboard and to a screen reader. A
      // <button> is focusable, activates on Enter and Space, and announces
      // itself, for free.
      for (const match of source.matchAll(/<(div|span)\b[^>]*onClick/gs)) {
        fake.push(`${relative(file)} → ${match[0].slice(0, 60)}`);
      }
    }

    expect(fake, `clickable non-buttons:\n${fake.join("\n")}`).toEqual([]);
  });
});

describe("error messages (section 19)", () => {
  /*
   * An error that is visible and silent.
   *
   * The first version of this rule demanded `aria-invalid`, and it found five
   * real components — but the rule was imprecise. There are two correct ways to
   * make an error audible, and which one applies depends on what the error is
   * about:
   *
   *   a FIELD error   -> `aria-invalid` on the control, plus `aria-describedby`
   *                      pointing at the message
   *   a FORM error    -> `role="alert"` on the message, because there is no
   *                      single control to mark. `errors.items` on an order
   *                      belongs to the list, not to any one input.
   *
   * Demanding `aria-invalid` everywhere would have forced the wrong fix on the
   * second case. What is never acceptable is neither: a red sentence a screen
   * reader announces as ordinary text, if it announces it at all.
   */
  it("announces every field error, one way or the other", async () => {
    const files = await collectFiles(join(ROOT, "src", "modules"), /\.tsx$/);
    const forms = files.filter((file) => /form|editor|manager/i.test(file));
    expect(forms.length).toBeGreaterThan(0);

    const silent: string[] = [];

    for (const file of forms) {
      const source = await readFile(file, "utf8");
      const showsFieldError = /text-destructive/.test(source);
      const announced = /invalid=|aria-invalid|role="alert"/.test(source);

      if (showsFieldError && !announced) silent.push(relative(file));
    }

    expect(
      silent,
      `components that show an error without marking the field invalid:\n${silent.join("\n")}`,
    ).toEqual([]);
  });
});
