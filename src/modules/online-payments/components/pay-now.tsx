"use client";

/**
 * "Pagar ahora" on the order tracking page (Phase 31).
 *
 * One button, three providers behind it:
 *
 *   Mercado Pago  the server creates a preference; the browser goes there.
 *   Izipay        the server issues a formToken; the provider's script renders
 *                 the card form, in its own iframes, inside this page.
 *   Culqi         the provider's Checkout v4 opens; the token it returns goes to
 *                 the server, which charges it.
 *
 * NOTHING HERE MARKS AN ORDER PAID. The Mercado Pago return URL, Izipay's
 * success callback and Culqi's token are all just signals to refresh: the
 * payment is recorded from the provider's own answer, on the server. The page
 * polls (see `AutoRefresh`) until the order says so.
 *
 * The providers' scripts are injected at click time by this (nonced) bundle, so
 * `'strict-dynamic'` admits them, and the tracking page is the only one whose
 * CSP frames their hosts (`lib/security/csp.ts`).
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { IconCard } from "@/components/ui/icons";
import { formatCurrency } from "@/lib/money";
import {
  buttonClass,
  displayStyle,
  mutedStyle,
  panelStyle,
  primaryButtonStyle,
} from "@/modules/storefront/components/site-styles";
import { chargeCulqiAction, startOnlinePaymentAction } from "../server/actions";

const CULQI_SCRIPT = "https://checkout.culqi.com/js/v4";
const IZIPAY_SCRIPT =
  "https://static.micuentaweb.pe/static/js/krypton-client/V4.0/stable/kr-payment-form.min.js";
const IZIPAY_THEME_JS =
  "https://static.micuentaweb.pe/static/js/krypton-client/V4.0/ext/classic.js";
const IZIPAY_THEME_CSS =
  "https://static.micuentaweb.pe/static/js/krypton-client/V4.0/ext/classic.css";

interface CulqiToken {
  id: string;
  email: string;
}

interface CulqiGlobal {
  publicKey: string;
  settings(options: Record<string, unknown>): void;
  options(options: Record<string, unknown>): void;
  open(): void;
  close(): void;
  token?: CulqiToken;
  error?: { user_message?: string };
}

interface KryptonGlobal {
  onSubmit(callback: (event: unknown) => boolean): void;
}

declare global {
  interface Window {
    Culqi?: CulqiGlobal;
    culqi?: () => void;
    KR?: KryptonGlobal;
  }
}

/** Loads a script once, resolving when it is ready. */
function loadScript(src: string, attributes: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing !== null) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

function loadStylesheet(href: string): void {
  if (document.querySelector(`link[href="${href}"]`) !== null) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

export function PayNow({
  token,
  amountCents,
  currency,
  providerLabel,
  status,
}: {
  token: string;
  amountCents: number;
  currency: string;
  providerLabel: string;
  status: "pending" | "rejected";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [izipayToken, setIzipayToken] = useState<{ formToken: string; publicKey: string } | null>(
    null,
  );
  const izipayHost = useRef<HTMLDivElement>(null);

  // Izipay: once the formToken exists, the container is in the DOM and the
  // provider's script can find it.
  useEffect(() => {
    if (izipayToken === null || izipayHost.current === null) return;
    let cancelled = false;

    const container = document.createElement("div");
    container.className = "kr-embedded";
    container.setAttribute("kr-form-token", izipayToken.formToken);
    izipayHost.current.replaceChildren(container);

    loadStylesheet(IZIPAY_THEME_CSS);
    void loadScript(IZIPAY_SCRIPT, {
      "kr-public-key": izipayToken.publicKey,
      "kr-language": "es-ES",
    })
      .then(() => loadScript(IZIPAY_THEME_JS))
      .then(() => {
        if (cancelled) return;
        window.KR?.onSubmit(() => {
          // Paid in the browser. The IPN is what records it; this only stops the
          // provider redirecting and starts waiting for that record.
          setProcessing(true);
          router.refresh();
          return false;
        });
      })
      .catch(() => {
        if (!cancelled) setError("No pudimos cargar el formulario de pago. Recarga la página.");
      });

    return () => {
      cancelled = true;
    };
  }, [izipayToken, router]);

  const openCulqi = async (start: {
    publicKey: string;
    amountCents: number;
    currency: string;
    title: string;
  }) => {
    await loadScript(CULQI_SCRIPT);
    const culqi = window.Culqi;
    if (culqi === undefined) throw new Error("Culqi did not load");

    culqi.publicKey = start.publicKey;
    culqi.settings({ title: start.title, currency: start.currency, amount: start.amountCents });
    culqi.options({
      lang: "auto",
      installments: false,
      paymentMethods: {
        tarjeta: true,
        yape: true,
        bancaMovil: false,
        agente: false,
        billetera: false,
        cuotealo: false,
      },
    });

    window.culqi = () => {
      const tokenFromCulqi = window.Culqi?.token;
      if (tokenFromCulqi !== undefined) {
        window.Culqi?.close();
        setProcessing(true);
        startTransition(async () => {
          const result = await chargeCulqiAction({
            token,
            culqiTokenId: tokenFromCulqi.id,
            email: tokenFromCulqi.email,
          });
          setProcessing(false);
          if (!result.ok) {
            setError(result.message);
            return;
          }
          router.refresh();
        });
      } else if (window.Culqi?.error !== undefined) {
        setError(window.Culqi.error.user_message ?? "El pago no se pudo completar.");
      }
    };

    culqi.open();
  };

  const start = () => {
    setError(null);
    startTransition(async () => {
      const result = await startOnlinePaymentAction(token);
      if (!result.ok) {
        setError(result.message);
        return;
      }

      try {
        switch (result.start.kind) {
          case "redirect":
            window.location.assign(result.start.url);
            return;
          case "izipay":
            setIzipayToken({
              formToken: result.start.formToken,
              publicKey: result.start.publicKey,
            });
            return;
          case "culqi":
            await openCulqi(result.start);
            return;
        }
      } catch {
        setError("No pudimos abrir la pasarela de pago. Recarga la página e inténtalo de nuevo.");
      }
    });
  };

  return (
    <section
      className="flex flex-col gap-4 p-6"
      style={{ ...panelStyle, borderColor: "var(--site-primary-line)" }}
    >
      <h2 className="flex items-center gap-2 text-lg" style={displayStyle}>
        <IconCard className="size-5" style={{ color: "var(--site-primary)" }} />
        {status === "rejected" ? "Tu pago no se completó" : "Paga tu pedido"}
      </h2>
      <p className="text-sm leading-relaxed" style={mutedStyle}>
        {processing
          ? "Estamos confirmando tu pago con la pasarela. Esta página se actualiza sola."
          : status === "rejected"
            ? `La pasarela rechazó el último intento. Puedes volver a intentarlo con otra tarjeta o con Yape.`
            : `Paga ${formatCurrency(amountCents, currency)} de forma segura con ${providerLabel}. Tus datos de tarjeta no pasan por esta web.`}
      </p>

      {izipayToken === null ? (
        <div>
          <button
            type="button"
            onClick={start}
            disabled={pending || processing}
            className={buttonClass}
            style={primaryButtonStyle}
          >
            {pending ? "Abriendo la pasarela…" : `Pagar ${formatCurrency(amountCents, currency)}`}
          </button>
        </div>
      ) : (
        <div ref={izipayHost} className="min-h-40" />
      )}

      {error !== null ? (
        <p role="alert" className="text-sm" style={{ color: "#dc2626" }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
