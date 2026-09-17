"use client";

/**
 * "Nuevo pedido web", with a sound, on whatever dashboard screen is open.
 *
 * A restaurant does not sit on the orders page. The owner is on the menu editor
 * or the cash register when somebody orders lunch from the website, and an
 * order nobody notices for twenty minutes is a customer lost - which is why Sugu
 * Rolls' panel had exactly this, and why it lives in the layout here.
 *
 * THE ONE PLACE A REALTIME PAYLOAD IS READ. ADR-020 says Realtime only triggers
 * a refresh and its payload is never trusted as data. This reads two fields -
 * `source` and `number` - to decide whether to chime and what to print, and
 * trusts neither for anything else: the link it offers goes through the order
 * page, which reads the order from the database under the member's own policy.
 * Realtime itself applies the `orders` SELECT policy before delivering the
 * event, so a member without `orders.view` never receives one.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IconCart, IconClose } from "@/components/ui/icons";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface Alert {
  readonly id: string;
  readonly number: number;
}

/** Two short rising notes, synthesised: no audio file to host or to block. */
function chime(): void {
  try {
    const context = new AudioContext();
    const notes = [880, 1320];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.18;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.4);
    });
    window.setTimeout(() => void context.close(), 1000);
  } catch {
    // No audio (autoplay policy before the first click, an old browser): the
    // visible alert below still appears, which is the part that matters.
  }
}

export function NewOrderAlert({ tenantId, tenantSlug }: { tenantId: string; tenantSlug: string }) {
  const router = useRouter();
  const [alerts, setAlerts] = useState<readonly Alert[]>([]);

  useEffect(() => {
    const client = createSupabaseBrowserClient();
    const channel = client
      .channel(`web-orders:${tenantId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders", filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          const row = payload.new as { id?: unknown; number?: unknown; source?: unknown };
          if (
            row.source !== "web" ||
            typeof row.id !== "string" ||
            typeof row.number !== "number"
          ) {
            return;
          }
          const alert: Alert = { id: row.id, number: row.number };
          setAlerts((current) =>
            [alert, ...current.filter((item) => item.id !== alert.id)].slice(0, 4),
          );
          chime();
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [tenantId, router]);

  if (alerts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="assertive"
      className="fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 print:hidden"
    >
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="bg-foreground text-background flex items-center gap-3 rounded-xl p-4 shadow-xl"
        >
          <span className="bg-background/15 flex size-9 shrink-0 items-center justify-center rounded-lg">
            <IconCart className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Nuevo pedido web #{alert.number}</p>
            <Link
              href={`/dashboard/${tenantSlug}/pedidos/${alert.id}`}
              onClick={() => setAlerts((current) => current.filter((item) => item.id !== alert.id))}
              className="text-xs underline underline-offset-2 opacity-80"
            >
              Ver pedido
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setAlerts((current) => current.filter((item) => item.id !== alert.id))}
            className="opacity-70 transition-opacity hover:opacity-100"
            aria-label="Cerrar aviso"
          >
            <IconClose className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
