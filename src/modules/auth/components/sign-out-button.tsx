import { Button } from "@/components/ui";
import { signOutAction } from "../server/actions";

/**
 * Sign out as a form POST rather than a link.
 *
 * A GET link would let any page on the internet sign a user out simply by
 * embedding it as an image. A form submission carries Next.js's Server Action
 * protection, which a cross-site request cannot forge.
 *
 * A Server Component: no client JavaScript is needed for a plain submit, and it
 * keeps working if the bundle has not loaded yet.
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="outline" size="sm">
        Cerrar sesion
      </Button>
    </form>
  );
}
