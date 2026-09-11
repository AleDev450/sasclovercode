import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { ChangePasswordForm } from "@/modules/auth";

export const metadata = { title: "Mi cuenta" };

/** The operator's own account. The platform layout already ran the gate. */
export default async function PlatformAccountPage() {
  const user = await requireUser();

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mi cuenta</h1>
        <p className="text-muted-foreground text-sm">{user.email}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Cambiar contrasena</CardTitle>
          <CardDescription>Necesitas tu contrasena actual para elegir una nueva.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
