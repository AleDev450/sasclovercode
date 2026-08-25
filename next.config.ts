import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every route.
 *
 * CLOVERCODE_MASTER.md section 9 requires secure headers from the start.
 *
 * `Content-Security-Policy` is deliberately NOT set here: a useful CSP for this
 * application needs per-request nonces and a stabilised surface (public tenant
 * sites, dashboard, POS). It is owned by Phase 25 - Security Hardening, and is
 * recorded as a known limitation in docs/specs/phase-00-foundation.md.
 */
const securityHeaders = [
  {
    // Two years, subdomains included. Every tenant is served over HTTPS,
    // including `{slug}.clovercodeapp.com`.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // No CloverCode surface is meant to be framed by a third party.
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "off",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
] as const;

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Do not advertise the framework version.
  poweredByHeader: false,

  // A type error must fail the build. Never relax this.
  //
  // There is no `eslint` key here on purpose: Next.js 16 removed `next lint`
  // and `next build` no longer runs ESLint at all
  // (node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md).
  // Linting is therefore a separate, mandatory step in `npm run verify` and in
  // the CI workflow.
  typescript: {
    ignoreBuildErrors: false,
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders.map((header) => ({ ...header })),
      },
    ];
  },
};

export default nextConfig;
