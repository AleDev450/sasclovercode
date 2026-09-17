/**
 * Content Security Policy, with a nonce per request.
 *
 * CLOVERCODE_MASTER.md section 9 asks for secure headers from the start. Phase
 * 00 shipped every other one and left this comment in `next.config.ts`:
 *
 *   "`Content-Security-Policy` is deliberately NOT set here: a useful CSP for
 *   this application needs per-request nonces ... It is owned by Phase 25."
 *
 * This is that phase, and this file is the policy.
 *
 * WHY NOT A STATIC HEADER IN `next.config.ts`. A static CSP needs
 * `script-src 'unsafe-inline'` for the scripts Next.js injects to run - and
 * `'unsafe-inline'` is precisely what a CSP exists to forbid. With it, the
 * policy does not stop the attack it claims to stop. A nonce is the documented
 * alternative and the only one that works (ADR-029 decision 1).
 *
 * Pure and free of `next/server`, so the policy is asserted directly in a unit
 * test rather than through a request.
 */

/** Header the proxy puts the nonce in, for a Server Component to read back. */
export const NONCE_HEADER = "x-nonce";

/**
 * A fresh, unguessable value per request.
 *
 * `randomUUID` is a CSPRNG. Base64 because that is the form a CSP source
 * expression takes, and because it keeps the value out of the character classes
 * a header would have to escape.
 */
export function generateNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

/**
 * Builds the policy.
 *
 * @param nonce         the value for this request
 * @param isDevelopment React uses `eval` in development to rebuild server error
 *                      stacks in the browser. Next.js documents that
 *                      `'unsafe-eval'` is required there and NOT in production,
 *                      and TEST-2505 pins that it never leaks into production.
 */
/**
 * The payment providers' own hosts (Phase 31, ADR-034).
 *
 * Culqi and Izipay collect card data inside THEIR iframes, loaded by THEIR
 * scripts, so the card never touches a restaurant's page - which is the whole
 * point of using them, and why `frame-src 'none'` cannot hold on the one page
 * that shows their form. The script itself needs no host here: our nonced
 * bundle injects it, and `'strict-dynamic'` trusts what a trusted script loads.
 *
 * Listed by exact host, not `https:`, and granted ONLY to the order tracking
 * page (see `isPaymentPath`). Every other page keeps `frame-src 'none'`.
 */
export const PAYMENT_FORM_HOSTS = {
  frames: [
    "https://checkout.culqi.com",
    "https://3ds.culqi.com",
    "https://static.micuentaweb.pe",
    "https://secure.micuentaweb.pe",
  ],
  styles: ["https://static.micuentaweb.pe"],
  fonts: ["https://static.micuentaweb.pe"],
} as const;

/** The pages that may render a provider's payment form: order tracking only. */
export function isPaymentPath(pathname: string): boolean {
  return /^\/(sitio|vista\/[^/]+)\/pedido\/[^/]+\/?$/.test(pathname);
}

export function buildContentSecurityPolicy(
  nonce: string,
  isDevelopment: boolean,
  options: { paymentForms?: boolean } = {},
): string {
  const payment = options.paymentForms === true;
  const extra = (hosts: readonly string[]) => (payment ? ` ${hosts.join(" ")}` : "");

  const directives = [
    "default-src 'self'",

    // `'strict-dynamic'` lets a script that carries the nonce load the chunks it
    // needs, which is what makes a nonce workable with a bundler at all. Note
    // that browsers supporting it IGNORE `'self'` in this directive - the nonce
    // becomes the whole gate, which is the point.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,

    // Tailwind emits a stylesheet, not inline styles - but Next.js injects
    // inline `<style>` during development, so the nonce alone would break the
    // dev server without this branch.
    //
    // This governs STYLESHEETS and `<style>` ELEMENTS. Style ATTRIBUTES are
    // governed by `style-src-attr` below, which deliberately says something
    // different.
    `style-src 'self' 'nonce-${nonce}'${extra(PAYMENT_FORM_HOSTS.styles)}${isDevelopment ? " 'unsafe-inline'" : ""}`,

    /*
     * Style ATTRIBUTES, and why this one says `'unsafe-inline'`.
     *
     * `style-src-attr` falls back to `style-src` when it is absent, so until
     * now the policy forbade every `style={...}` in the product - and the
     * product has several that are not decoration:
     *
     *   - the tenant theme, which reaches a public site as `--site-*` custom
     *     properties on one wrapper element (`modules/seo/theme.ts`). This is
     *     the whole of Phase 08's theming, and with the attribute dropped a
     *     business's colours simply never applied in production.
     *   - the bar widths in the sales reports, which are a number per row.
     *   - the colour swatches in the theme editor.
     *
     * A NONCE CANNOT FIX THIS. Nonces apply to elements, not to attributes;
     * there is no such thing as a nonced `style=""`. The only alternatives were
     * a generated `<style>` block - which `theme.ts` argues against at length,
     * because a stylesheet built by concatenation is one an author can inject
     * into - or dropping the feature.
     *
     * WHAT IS ACTUALLY GIVEN UP. An attacker who can already inject markup
     * could add a `style` attribute: an exfiltrating `background: url(...)`, or
     * a full-viewport overlay for clickjacking. Both require the injection to
     * happen first, and `script-src` - which keeps its nonce and gives up
     * nothing - is the directive that stops that. Note also what is NOT given
     * up: `style-src` above still refuses an inline `<style>` element without
     * the nonce, so the larger primitive stays closed.
     *
     * Every value that reaches a style attribute here is either a literal in
     * the source or a value React serialises through its style-object escaping,
     * and the tenant colours are additionally re-validated against
     * `^#[0-9a-f]{6}$` at render time.
     */
    "style-src-attr 'unsafe-inline'",

    // `blob:` and `data:` because a tenant's logo can be previewed before it is
    // uploaded, and Supabase Storage serves the stored one over https.
    "img-src 'self' blob: data: https:",
    `font-src 'self' data:${extra(PAYMENT_FORM_HOSTS.fonts)}`,

    // Supabase: PostgREST, Auth, Storage and the Realtime socket the KDS opens
    // (Phase 16). `https:` and `wss:` rather than a specific host because the
    // project URL is environment configuration, not a build-time constant.
    "connect-src 'self' https: wss:",

    // No plugins. `object-src 'none'` is the single most valuable directive
    // after script-src, and there is nothing here that needs an <object>.
    "object-src 'none'",

    // Stops an injected <base> from silently repointing every relative URL.
    "base-uri 'self'",

    // A form on this site posts to this site. Nothing here posts anywhere else.
    "form-action 'self'",

    // Clickjacking. `X-Frame-Options: DENY` (Phase 00) says the same thing to
    // older browsers; this is the modern spelling and both are kept.
    "frame-ancestors 'none'",
    payment ? `frame-src ${PAYMENT_FORM_HOSTS.frames.join(" ")}` : "frame-src 'none'",

    "upgrade-insecure-requests",
  ];

  return directives.join("; ");
}
