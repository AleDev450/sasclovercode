/*
 * From its own file, NOT from the `@/components/ui` barrel - and this import
 * is load-bearing for the Content-Security-Policy.
 *
 * The barrel also re-exports client components that use `next/link`. Imported
 * here, they made the loading boundary a segment with client code, and Next.js
 * renders the chunks of a loading boundary as a `<script async>` in the React
 * tree WITHOUT the request's nonce. Under `'strict-dynamic'` the browser blocks
 * an un-nonced script, so every page in the product logged a CSP violation for
 * the `next/link` chunk (reproduced on a production build: 1 of 14 scripts
 * with no nonce, on every route). A skeleton needs no JavaScript at all;
 * imported directly, it pulls none, and Next.js emits no script for it.
 */
import { Skeleton } from "@/components/ui/skeleton";

/** Route-level loading state (section 34: always show a loading state). */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-6 py-16"
    >
      <span className="sr-only">Cargando</span>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-4 w-full max-w-prose" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}
