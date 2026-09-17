/**
 * The closed markup of a policy page, parsed to data.
 *
 * A restaurant's terms and privacy policy need exactly three things beyond
 * paragraphs: section headings, bullet lists and a little bold. That is the
 * whole language - `### Titulo`, `- punto`, `**negrita**` - and it is parsed
 * here into plain objects that a component turns into elements. Nothing is ever
 * interpreted as HTML (master section 33): a `<script>` typed into a policy is
 * printed as those characters, like everywhere else on the site.
 *
 * The same markup Sugu Rolls' panel used, so an owner moving their texts over
 * pastes them unchanged.
 */

export type InlinePart = { readonly text: string; readonly bold: boolean };

export type LegalBlock =
  | { readonly kind: "heading"; readonly parts: readonly InlinePart[] }
  | { readonly kind: "paragraph"; readonly parts: readonly InlinePart[] }
  | { readonly kind: "list"; readonly items: readonly (readonly InlinePart[])[] };

/** `a **b** c` -> text / bold / text. An unclosed `**` is just two asterisks. */
export function parseInline(line: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;

  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: line.slice(last, index), bold: false });
    parts.push({ text: match[1]!, bold: true });
    last = index + match[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last), bold: false });

  return parts.length > 0 ? parts : [{ text: "", bold: false }];
}

export function parseLegalMarkup(source: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", parts: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    blocks.push({ kind: "list", items: list.map(parseInline) });
    list = [];
  };

  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();

    if (line.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading !== null) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", parts: parseInline(heading[1]!) });
      continue;
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet !== null) {
      flushParagraph();
      list.push(bullet[1]!);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}
