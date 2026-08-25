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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
