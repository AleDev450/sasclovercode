import { eyebrowStyle, headlineStyle, mutedStyle } from "./site-styles";

/** The opening of every fixed storefront page: eyebrow, title, one line. */
export function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <header
      className="flex flex-col items-center gap-4 text-center"
      style={{ paddingBlock: "calc(var(--site-section-space) / 2)" }}
    >
      <span className="text-xs font-semibold" style={eyebrowStyle}>
        {eyebrow}
      </span>
      <h1
        className="max-w-3xl text-balance"
        style={{ ...headlineStyle, fontSize: "var(--site-hero-size)" }}
      >
        {title}
      </h1>
      {description !== undefined ? (
        <p className="max-w-prose text-base leading-relaxed sm:text-lg" style={mutedStyle}>
          {description}
        </p>
      ) : null}
    </header>
  );
}
