import Link from "next/link";
import { EmptyState, buttonVariants } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl items-center px-6 py-16">
      <EmptyState
        className="w-full"
        title="Pagina no encontrada"
        description="El enlace que seguiste no existe o fue movido."
        action={
          // A navigation target must be an anchor, never a <button>. Styling
          // comes from the shared variants so it still looks like a button.
          <Link href="/" className={buttonVariants({ variant: "default", size: "md" })}>
            Volver al inicio
          </Link>
        }
      />
    </main>
  );
}
