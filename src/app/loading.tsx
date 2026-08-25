import { Skeleton } from "@/components/ui";

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
