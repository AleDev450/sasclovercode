"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the page on an interval while something is still moving.
 *
 * Polling and not Realtime: the visitor has no session, and Realtime under RLS
 * would have to open `orders` to `anon` to deliver an event - the one thing the
 * tracking design exists to avoid. A thirty-second refresh of a server-rendered
 * page tells somebody waiting for lunch everything they need.
 */
export function AutoRefresh({ seconds, active }: { seconds: number; active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [router, seconds, active]);

  return null;
}
