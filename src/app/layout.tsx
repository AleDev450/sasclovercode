import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { APP_DESCRIPTION, APP_NAME } from "@/config/app";
import "./globals.css";

/*
 * Deliberately reads `process.env` directly instead of `getPublicEnv()`.
 *
 * Metadata is evaluated at build time. Calling the validated env layer here
 * would make `next build` fail on any machine without Supabase credentials -
 * exactly the failure mode that edge case EC-02 of the Phase 00 SPEC forbids.
 */
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: APP_NAME,
    // Phase 08 replaces this with per-tenant metadata resolved from hostname.
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  robots: {
    // The platform dashboard is never indexed. Public tenant sites get their
    // own robots configuration in Phase 08.
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

/**
 * Nothing in this application is prerendered. Phase 25, and it is the price of
 * the Content-Security-Policy.
 *
 * The CSP carries a nonce generated per request in the proxy, and Next.js
 * attaches it to every script it emits during SERVER RENDERING. A page built at
 * build time has no request and therefore no nonce, so its inline bootstrap
 * script would be blocked by the very policy that protects everything else -
 * the page would render and never hydrate. The Next.js documentation states it
 * flatly: "When you use nonces in your CSP, all pages must be dynamically
 * rendered."
 *
 * Declared ONCE here rather than on each page for two reasons. It is a property
 * of the whole application, not of four routes. And a fifth static page added
 * later would silently slip past four scattered flags, breaking in production
 * in a way that looks like a hydration bug rather than a security setting.
 *
 * The cost is small and was measured: exactly four routes were prerendered
 * before this line - `/`, `/_not-found`, `/forgot-password` and
 * `/reset-password`. All four are trivial and none is on a hot path; every
 * other route in the product was already dynamic (ADR-029 decision 1).
 */
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
