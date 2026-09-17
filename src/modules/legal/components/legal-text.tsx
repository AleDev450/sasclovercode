import { Fragment } from "react";
import { parseLegalMarkup, type InlinePart } from "../markup";

/**
 * A policy text, drawn from parsed blocks.
 *
 * Every string reaches the DOM as a JSX child, which React escapes: this file
 * turns `### `, `- ` and `**` into elements and does nothing else. There is no
 * `dangerouslySetInnerHTML` here, as there is none anywhere on the site.
 */

function Inline({ parts }: { parts: readonly InlinePart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.bold ? (
          <strong key={index} style={{ color: "var(--site-foreground)" }}>
            {part.text}
          </strong>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

export function LegalText({ source }: { source: string }) {
  const blocks = parseLegalMarkup(source);

  return (
    <div
      className="flex flex-col gap-4 text-base leading-relaxed"
      style={{ color: "var(--site-muted)" }}
    >
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return (
            <h2
              key={index}
              className="mt-6 text-2xl first:mt-0"
              style={{
                color: "var(--site-foreground)",
                fontFamily: "var(--site-display-font)",
                fontWeight: "var(--site-display-weight)",
                letterSpacing: "var(--site-display-tracking)",
              }}
            >
              <Inline parts={block.parts} />
            </h2>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={index} className="flex list-disc flex-col gap-2 pl-6">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline parts={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            <Inline parts={block.parts} />
          </p>
        );
      })}
    </div>
  );
}
