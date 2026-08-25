import type { Metadata } from "next";
import { AuthFormShell, UpdatePasswordForm } from "@/modules/auth";

export const metadata: Metadata = {
  title: "Nueva contrasena",
};

/**
 * Reached from the recovery email, via `/auth/confirm`, which exchanges the
 * token for a session before redirecting here.
 *
 * This page does NOT verify the session itself. The action behind the form
 * does, and that is the check that matters: rendering a form to somebody
 * without a valid recovery session is harmless, while letting the update
 * through would not be.
 */
export default function ResetPasswordPage() {
  return (
    <AuthFormShell
      title="Nueva contrasena"
      description="Elige una contrasena nueva para tu cuenta."
    >
      <UpdatePasswordForm />
    </AuthFormShell>
  );
}
