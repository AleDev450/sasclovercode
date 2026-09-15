import type { ReactNode } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { VendraWordmark } from "@/components/ui";
import { VENDOR_NAME, VENDOR_SITE } from "@/config/app";

export interface AuthFormShellProps {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

/**
 * Shared frame for every authentication screen.
 *
 * One component rather than three near-identical layouts, per master section 34
 * (reusable components, consistent spacing and hierarchy).
 *
 * IT WEARS THE PRODUCT MARK, NOT THE PLATFORM NAME. This used to print
 * `APP_NAME` - "CloverCode" - in small uppercase above the card, and that was
 * wrong in a way worth naming: the person signing in here is a shop owner
 * opening the panel of the product they bought. They bought Vendra. Telling
 * them the name of the company that built it, at the moment they are checking
 * they are on the right site, is the exact identity confusion the two-mark
 * split exists to prevent.
 *
 * It is the full artwork rather than `ProductLogo`, because this is the one
 * screen whose whole job is a first impression and where nothing competes with
 * it for space.
 */
export function AuthFormShell({ title, description, children, footer }: AuthFormShellProps) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-7 px-6 py-12">
      <Link href="/" className="self-center rounded-lg">
        <VendraWordmark className="w-52 dark:hidden" />
        <VendraWordmark tone="inverted" className="hidden w-52 dark:block" />
      </Link>

      <Card variant="elevated">
        <CardHeader>
          <CardTitle as="h1">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">{children}</CardContent>
      </Card>

      {footer === undefined ? null : (
        <div className="text-muted-foreground text-center text-sm">{footer}</div>
      )}

      {/* The authorship credit, kept small and at the bottom where it belongs. */}
      <a
        href={VENDOR_SITE}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-foreground self-center text-xs transition-colors"
      >
        Desarrollado por {VENDOR_NAME}
      </a>
    </main>
  );
}
