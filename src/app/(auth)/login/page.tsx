import type { Metadata } from "next";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { AuthFormShell, SignInForm } from "@/modules/auth";

export const metadata: Metadata = {
  title: "Iniciar sesion",
};

/**
 * Messages this page may show in response to `?error=`.
 *
 * A fixed map rather than rendering the parameter: the value comes from the URL
 * and anyone can put anything in it, so echoing it would let a crafted link
 * display arbitrary text on a page that looks like ours.
 */
const ERROR_NOTICES: Readonly<Record<string, string>> = {
  invalid_link: "El enlace ha expirado o ya se utilizo. Solicita uno nuevo.",
};

/**
 * `searchParams` makes this route dynamic, which is correct: the rendered form
 * depends on `next`, and a cached sign-in page would carry one visitor's
 * redirect target into another's session.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  // Filtered here so a hostile `next` never reaches the rendered HTML, and
  // filtered again in the action, which a client can call directly.
  const safeNext = safeRedirectPath(next);

  // `error` is echoed from the URL, so it is never rendered directly. It only
  // selects a message from this map; an unrecognised value shows nothing.
  const noticeMessage = ERROR_NOTICES[error ?? ""];

  return (
    <AuthFormShell
      title="Iniciar sesion"
      description="Accede al panel de tu negocio."
      footer={
        <Link
          href="/forgot-password"
          className="hover:text-foreground underline underline-offset-4"
        >
          Olvide mi contrasena
        </Link>
      }
    >
      {noticeMessage === undefined ? null : (
        <Alert variant="warning">
          <AlertDescription>{noticeMessage}</AlertDescription>
        </Alert>
      )}

      <SignInForm next={safeNext} />
    </AuthFormShell>
  );
}
