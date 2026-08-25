import Link from "next/link";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  buttonVariants,
} from "@/components/ui";
import { createTenantAction } from "@/modules/platform/server/actions";

export const metadata = { title: "Crear empresa" };

export default function NewTenantPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Crear empresa</h1>
        <p className="text-muted-foreground text-sm">
          Se creara la empresa, su dominio de sistema y su propietario en una sola operacion.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Datos de la empresa</CardTitle>
          <CardDescription>El propietario debe tener cuenta antes de asignarlo.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createTenantAction} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Nombre</Label>
              <Input id="name" name="name" required maxLength={120} autoComplete="off" />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                name="slug"
                required
                minLength={3}
                maxLength={63}
                pattern="[a-z0-9]([a-z0-9\-]*[a-z0-9])?"
                autoComplete="off"
                aria-describedby="slug-help"
              />
              <p id="slug-help" className="text-muted-foreground text-xs">
                Sera su dominio: <code className="font-mono">slug.clovercodeapp.com</code>. Solo
                minusculas, numeros y guiones.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ownerEmail">Correo del propietario</Label>
              <Input id="ownerEmail" name="ownerEmail" type="email" required autoComplete="off" />
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit">Crear empresa</Button>
              <Link href="/super-admin/tenants" className={buttonVariants({ variant: "ghost" })}>
                Cancelar
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
