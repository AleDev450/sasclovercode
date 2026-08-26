# ADR-012 — One allow-listed script, and what a public website may read

```text
Status: ACCEPTED
Date:   2026-08-25
Phase:  08 — SEO + Metadata
```

## Context

Phase 07 built the public website and made one guarantee explicit: **nothing on
a tenant site interprets markup**. There is no `html` field in any section
schema, the renderer uses no `dangerouslySetInnerHTML`, and TEST-726 asserts
this over the source of every file under `src/modules/cms` and
`src/app/(site)`. The guarantee is worth having because the alternative is
stored XSS on the tenant's own origin, which is where their customers'
sessions live.

Phase 08 arrives with two requirements that push against decisions taken
earlier:

1. Master section 31 asks for **structured data**. Structured data means
   JSON-LD, and JSON-LD means a `<script type="application/ld+json">` whose body
   is JSON. React escapes text children, and escaped text is not valid JSON, so
   the payload cannot be passed as a child.

2. Master section 33 says **each tenant must be treated as an independent
   site**. A site cannot be independent while its theme, its trade name and its
   images are readable only by its own staff — and Phase 06 had made all three
   member-only, because at the time nobody anonymous had any business reading
   them.

Both had an obvious answer that would have been wrong.

## Decision

### 1. JSON-LD is a named exception, not a relaxed rule

`src/modules/seo/structured-data.tsx` is the single file in the public site
allowed to use `dangerouslySetInnerHTML`, and it is allow-listed **by name** in
TEST-726 rather than being placed outside the checked directories.

The escaping is a pure exported function, `serializeJsonLd`, which builds the
payload with `JSON.stringify` and then escapes `<` as `\u003c` (plus U+2028
and U+2029). That defeats the whole attack class: an HTML parser scanning for
the closing tag does not care that `</script>` sits inside a JSON string, so
without the escape a business name could end the element and take over the
page. `\u003c` is `<` to a JSON parser, so the data survives the round trip
unchanged.

TEST-821 to TEST-823 attack the function directly with a `</script>` payload,
and TEST-824 asserts that the allow-list still has exactly one entry and that
the file it names still escapes.

The reason to do it this way rather than quietly moving the file somewhere the
test does not look: an exception nobody can see is an exception that grows.

### 2. The public site reads a widened, narrow set

Three things became readable to `anon` **and** `authenticated`:

| What              | How                                                    |
| ----------------- | ------------------------------------------------------ |
| `tenant_seo`      | RLS policy, `is_tenant_public(tenant_id)`              |
| `tenant_themes`   | RLS policy, `is_tenant_public(tenant_id)`              |
| public assets     | `storage.objects` policy, three folders only           |
| business identity | `get_public_business_identity()`, SECURITY DEFINER     |

The theme is public because every value in the row is visible in the rendered
page: hiding it hid nothing while making the site unable to render itself.

`tenant_settings` is deliberately **not** public. PostgreSQL RLS is row-level,
so a policy that published the trade name would publish the RUC, the legal name
and the contact email sitting in the same row. A SECURITY DEFINER function
returns the five fields a website displays and none of the fiscal ones. That is
the same shape as `resolve_tenant_by_domain` from Phase 01, and for the same
reason.

Both roles, from the start. The Phase 07 audit (A7-1) found that granting only
`anon` makes a public site invisible to anyone holding a CloverCode session,
because a signed-in stranger matches neither the public policy nor the member
one. "Publishable" is a property of the row, not of who is reading it.

### 3. The asset policy fixes a defect, it does not add a capability

The `tenant-assets` bucket is private and Phase 06 gave it exactly one read
policy, for members. Phase 07 then built public websites that render images
from it — signed as the **visitor**, who is anonymous. Every logo, banner and
product photo on every public site failed to sign and was silently omitted.

It looked correct to anyone testing while signed in to the business, which is
how it survived a phase and an audit. Phase 08 would have inherited it for the
og:image and the favicon, whose consumer is a crawler with no session at all.

The new policy covers `branding`, `banners` and `products` — the folders a
website shows — and deliberately excludes `documents`, which holds invoices and
contracts and appears on no page.

### 4. The theme travels as CSS custom properties

Colours reach the page as `--site-*` variables in a React `style` object on one
wrapper element, never as a generated `<style>` block.

A stylesheet built by string concatenation is a stylesheet an author can inject
into, and CSS injection is not harmless: `background: url(...)` exfiltrates, and
a full-viewport overlay is a workable clickjacking primitive. React serialises a
style object by escaping it, so no stored value can end the attribute or open a
rule. The database CHECK constrains every colour to `^#[0-9a-f]{6}$` and
`themeCssVariables` re-checks it, because the value has crossed PostgREST, JSON
and a type assertion since the CHECK ran.

## Alternatives considered

**Render structured data as microdata attributes instead of JSON-LD.** Would
have avoided the script element entirely. Rejected: Google documents JSON-LD as
the preferred format, microdata means threading `itemprop` attributes through
every renderer, and the attributes would then be the thing carrying tenant text
into markup — moving the risk rather than removing it.

**Put the JSON-LD component outside the directories TEST-726 scans.** The test
would have stayed green. Rejected on the grounds that a guarantee which can be
satisfied by moving a file is not a guarantee.

**Escape only `</script>` rather than every `<`.** Cheaper and nearly right,
which is the worst combination. `<!--` starts an HTML comment inside a script
and can also change how the element is parsed; escaping the character rather
than the sequence removes the class instead of the instance.

**A public policy on `tenant_settings` with a view for the private columns.**
Rejected: the view would need `security_invoker = false` to be useful, at which
point it is a SECURITY DEFINER function with extra steps and a second object
that can drift from the first.

**Signing the favicon and og:image at build time into a public bucket.** Would
survive expiry and be cacheable. Rejected for this phase: it means a second
bucket with different rules and a sync step that can fail independently of the
write it mirrors. Revisit if signed-URL expiry proves to matter (KL-806).

## Consequences

- One file in the public site may write into a script element. It is named in a
  test, its escaping is attacked by three others, and adding a second name is a
  decision somebody has to make on purpose.
- A tenant's theme, SEO row and public images are readable by the whole
  internet. That is what publishing a website means; the fiscal identity next
  door stays private.
- `tenant_settings` gains no public policy, so any future public field needs a
  deliberate addition to `get_public_business_identity` rather than a policy
  change nobody reviews.
- Suspension now reaches the crawler: a suspended business serves `noindex`, an
  empty sitemap and a restrictive robots.txt, whatever its own setting says.
