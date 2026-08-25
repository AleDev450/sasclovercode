import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { APP_NAME } from "@/config/app";

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
 */
export function AuthFormShell({ title, description, children, footer }: AuthFormShellProps) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="flex flex-col gap-1 text-center">
        <span className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
          {APP_NAME}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h1">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">{children}</CardContent>
      </Card>

      {footer === undefined ? null : (
        <div className="text-muted-foreground text-center text-sm">{footer}</div>
      )}
    </main>
  );
}
