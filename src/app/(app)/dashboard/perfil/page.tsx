import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { ProfileForm } from "@/modules/dashboard/components/profile-form";

export const metadata = { title: "Perfil" };

export default async function ProfilePage() {
  const user = await requireUser();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tu perfil</h1>
        <p className="text-muted-foreground text-sm">
          Estos datos son tuyos y no cambian entre empresas.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Datos personales</CardTitle>
          <CardDescription>Para cambiar la contrasena usa la opcion de acceso.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm email={user.email} fullName={user.fullName} />
        </CardContent>
      </Card>

      <Link href="/dashboard" className="text-muted-foreground text-sm hover:underline">
        Volver a mis empresas
      </Link>
    </main>
  );
}
