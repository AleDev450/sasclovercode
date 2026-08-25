import type { Metadata } from "next";
import Link from "next/link";
import { AuthFormShell, RequestPasswordResetForm } from "@/modules/auth";

export const metadata: Metadata = {
  title: "Recuperar contrasena",
};

export default function ForgotPasswordPage() {
  return (
    <AuthFormShell
      title="Recuperar contrasena"
      description="Introduce tu correo y te enviaremos un enlace para restablecerla."
      footer={
        <Link href="/login" className="hover:text-foreground underline underline-offset-4">
          Volver a iniciar sesion
        </Link>
      }
    >
      <RequestPasswordResetForm />
    </AuthFormShell>
  );
}
