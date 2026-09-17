"use client";

/**
 * The Libro de Reclamaciones virtual: the sheet, and the constancia after it.
 *
 * The fields and their grouping follow the sheet the regulation describes -
 * the consumer, the product or service, the complaint and what is asked for -
 * so a consumer who has filled a paper one recognises this, and an inspector
 * reading it finds each block where they expect it.
 *
 * THE CONSTANCIA IS SHOWN, AND PRINTABLE. The regulation requires the consumer
 * to receive a copy with its number. CloverCode has no outgoing email yet (see
 * the Phase 30 SPEC, known limitations), so the sheet is shown in full with a
 * print button the moment it is filed, and the number is the proof.
 */

import { useState, useTransition, type ReactNode } from "react";
import { IconCheck } from "@/components/ui/icons";
import { formatCurrency, parseMoney } from "@/lib/money";
import {
  buttonClass,
  displayStyle,
  fieldClass,
  fieldStyle,
  mutedStyle,
  panelStyle,
  primaryButtonStyle,
  subtleStyle,
} from "@/modules/storefront/components/site-styles";
import { DOCUMENT_TYPES } from "../schemas";
import { submitComplaintAction } from "../server/actions";

interface Provider {
  readonly name: string;
  readonly taxId: string | null;
  readonly address: string | null;
}

interface Filed {
  readonly number: number;
  readonly filedAt: string;
  readonly dueOn: string;
}

const DOCUMENT_LABELS: Record<(typeof DOCUMENT_TYPES)[number], string> = {
  DNI: "DNI",
  CE: "Carné de extranjería",
  PASAPORTE: "Pasaporte",
  RUC: "RUC",
};

function Section({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-5 p-6" style={panelStyle}>
      <legend className="sr-only">{title}</legend>
      <h2 className="flex items-center gap-3 text-xl" style={displayStyle}>
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
          style={{ background: "var(--site-primary)", color: "var(--site-on-primary)" }}
        >
          {number}
        </span>
        {title}
      </h2>
      {children}
    </fieldset>
  );
}

function ErrorText({ errors }: { errors?: readonly string[] }) {
  return errors !== undefined ? (
    <p className="text-xs" style={{ color: "#dc2626" }}>
      {errors[0]}
    </p>
  ) : null;
}

export function ComplaintForm({ provider, preview }: { provider: Provider; preview: boolean }) {
  const [pending, startTransition] = useTransition();
  const [filed, setFiled] = useState<Filed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, readonly string[]>>>({});

  const [values, setValues] = useState({
    consumerName: "",
    consumerAddress: "",
    documentType: "DNI" as (typeof DOCUMENT_TYPES)[number],
    documentNumber: "",
    consumerEmail: "",
    consumerPhone: "",
    isMinor: false,
    guardianName: "",
    itemType: "producto" as "producto" | "servicio",
    amount: "",
    itemDescription: "",
    orderReference: "",
    incidentDate: "",
    type: "reclamo" as "reclamo" | "queja",
    detail: "",
    consumerRequest: "",
    responseChannel: "email" as "email" | "address",
    acceptedDeclaration: false,
  });

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (preview || pending) return;

    let amountCents: number | null = null;
    if (values.amount.trim().length > 0) {
      const parsed = parseMoney(values.amount);
      if (!parsed.ok || parsed.cents === undefined || parsed.cents < 0) {
        setFieldErrors({ amountCents: ["Escribe un monto como 45.90"] });
        return;
      }
      amountCents = parsed.cents;
    }

    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await submitComplaintAction({
        ...values,
        amountCents,
        guardianName: values.isMinor ? values.guardianName : undefined,
        orderReference: values.orderReference.length > 0 ? values.orderReference : undefined,
      });

      if (!result.ok) {
        setError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setFiled({ number: result.number, filedAt: result.filedAt, dueOn: result.dueOn });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  if (filed !== null) {
    const filedAt = new Intl.DateTimeFormat("es-PE", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "America/Lima",
    }).format(new Date(filed.filedAt));
    const due = new Intl.DateTimeFormat("es-PE", { dateStyle: "long", timeZone: "UTC" }).format(
      new Date(`${filed.dueOn}T00:00:00Z`),
    );
    const sheetNumber = `${String(filed.number).padStart(6, "0")}-${new Date(filed.filedAt).getFullYear()}`;

    const rows: [string, string][] = [
      [
        "Proveedor",
        provider.taxId !== null ? `${provider.name} · RUC ${provider.taxId}` : provider.name,
      ],
      ...(provider.address !== null
        ? ([["Domicilio del proveedor", provider.address]] as [string, string][])
        : []),
      ["Fecha de registro", filedAt],
      ["Respuesta a más tardar", due],
      ["Consumidor", values.consumerName],
      ["Documento", `${values.documentType} ${values.documentNumber}`],
      ["Domicilio", values.consumerAddress],
      ["Correo", values.consumerEmail],
      ["Teléfono", values.consumerPhone],
      ...(values.isMinor
        ? ([["Padre, madre o apoderado", values.guardianName]] as [string, string][])
        : []),
      [
        "Bien contratado",
        `${values.itemType === "producto" ? "Producto" : "Servicio"}: ${values.itemDescription}`,
      ],
      ...(values.amount.trim().length > 0
        ? ([["Monto reclamado", formatCurrency(parseMoney(values.amount).cents ?? 0, "PEN")]] as [
            string,
            string,
          ][])
        : []),
      ["Tipo", values.type === "reclamo" ? "Reclamo" : "Queja"],
      ["Detalle", values.detail],
      ["Pedido del consumidor", values.consumerRequest],
      ["Respuesta por", values.responseChannel === "email" ? "Correo electrónico" : "Domicilio"],
    ];

    return (
      <section className="flex flex-col gap-6" aria-labelledby="constancia-title">
        <div className="flex flex-col items-center gap-3 text-center">
          <span
            className="flex size-14 items-center justify-center rounded-full"
            style={{ background: "#dcfce7", color: "#166534" }}
            aria-hidden
          >
            <IconCheck className="size-7" />
          </span>
          <h2 id="constancia-title" className="text-3xl" style={displayStyle}>
            Hoja de reclamación N° {sheetNumber}
          </h2>
          <p className="max-w-prose" style={mutedStyle}>
            Registramos tu {values.type}. Guarda o imprime esta constancia: el número es tu
            comprobante.
          </p>
        </div>

        <dl className="flex flex-col p-6 text-sm" style={panelStyle}>
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="grid gap-1 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4"
              style={{ borderBottom: "1px solid var(--site-border)" }}
            >
              <dt style={subtleStyle}>{label}</dt>
              <dd className="break-words whitespace-pre-line">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex justify-center gap-3 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className={buttonClass}
            style={primaryButtonStyle}
          >
            Imprimir o guardar en PDF
          </button>
        </div>
      </section>
    );
  }

  // Value and handler only: the `id` is written on each control, where the
  // label pairing can be read (and checked) without evaluating anything.
  const text = (key: keyof typeof values) => ({
    value: values[key] as string,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
    ) => set(key, event.target.value as never),
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-1 p-6 text-sm" style={panelStyle}>
        <p className="font-semibold" style={{ color: "var(--site-foreground)" }}>
          {provider.name}
        </p>
        {provider.taxId !== null ? <p style={mutedStyle}>RUC {provider.taxId}</p> : null}
        {provider.address !== null ? <p style={mutedStyle}>{provider.address}</p> : null}
      </div>

      {preview ? (
        <p
          className="p-4 text-sm"
          style={{ ...panelStyle, background: "var(--site-surface-strong)" }}
        >
          Vista previa: el formulario no registra reclamos desde el panel.
        </p>
      ) : null}

      <Section number={1} title="Tus datos">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <label htmlFor="complaint-consumerName" className="text-sm font-medium">
              Nombre completo
            </label>
            <input
              id="complaint-consumerName"
              {...text("consumerName")}
              autoComplete="name"
              maxLength={200}
              className={fieldClass}
              style={fieldStyle}
            />
            <ErrorText errors={fieldErrors.consumerName} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="complaint-documentType" className="text-sm font-medium">
              Tipo de documento
            </label>
            <select
              id="complaint-documentType"
              {...text("documentType")}
              className={fieldClass}
              style={fieldStyle}
            >
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {DOCUMENT_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="complaint-documentNumber" className="text-sm font-medium">
              Número de documento
            </label>
            <input
              id="complaint-documentNumber"
              {...text("documentNumber")}
              maxLength={20}
              className={fieldClass}
              style={fieldStyle}
            />
            <ErrorText errors={fieldErrors.documentNumber} />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <label htmlFor="complaint-consumerAddress" className="text-sm font-medium">
              Domicilio
            </label>
            <input
              id="complaint-consumerAddress"
              {...text("consumerAddress")}
              autoComplete="street-address"
              maxLength={300}
              className={fieldClass}
              style={fieldStyle}
            />
            <ErrorText errors={fieldErrors.consumerAddress} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="complaint-consumerEmail" className="text-sm font-medium">
              Correo electrónico
            </label>
            <input
              id="complaint-consumerEmail"
              {...text("consumerEmail")}
              type="email"
              autoComplete="email"
              maxLength={200}
              className={fieldClass}
              style={fieldStyle}
            />
            <ErrorText errors={fieldErrors.consumerEmail} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="complaint-consumerPhone" className="text-sm font-medium">
              Teléfono
            </label>
            <input
              id="complaint-consumerPhone"
              {...text("consumerPhone")}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={30}
              className={fieldClass}
              style={fieldStyle}
            />
            <ErrorText errors={fieldErrors.consumerPhone} />
          </div>
        </div>

        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={values.isMinor}
            onChange={(event) => set("isMinor", event.target.checked)}
            className="size-4"
            style={{ accentColor: "var(--site-primary)" }}
          />
          Soy menor de edad
        </label>
        {values.isMinor ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="complaint-guardianName" className="text-sm font-medium">
              Nombre del padre, madre o apoderado
            </label>
            <input
              id="complaint-guardianName"
              {...text("guardianName")}
              maxLength={200}
              className={fieldClass}
              style={fieldStyle}
            />
            <ErrorText errors={fieldErrors.guardianName} />
          </div>
        ) : null}
      </Section>

      <Section number={2} title="Producto o servicio">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Bien contratado">
          {(["producto", "servicio"] as const).map((option) => (
            <label
              key={option}
              className="flex h-12 cursor-pointer items-center justify-center gap-2 text-sm font-medium"
              style={{
                borderRadius: "var(--site-radius-chip)",
                border: `1px solid ${values.itemType === option ? "var(--site-primary)" : "var(--site-border-strong)"}`,
                background: values.itemType === option ? "var(--site-primary-soft)" : "transparent",
              }}
            >
              <input
                type="radio"
                name="itemType"
                checked={values.itemType === option}
                onChange={() => set("itemType", option)}
                className="sr-only"
              />
              {option === "producto" ? "Producto" : "Servicio"}
            </label>
          ))}
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <label htmlFor="complaint-amount" className="text-sm font-medium">
              Monto reclamado (S/)
            </label>
            <input
              id="complaint-amount"
              {...text("amount")}
              inputMode="decimal"
              placeholder="Opcional"
              className={fieldClass}
              style={fieldStyle}
            />
            <ErrorText errors={fieldErrors.amountCents} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="complaint-orderReference" className="text-sm font-medium">
              N° de pedido
            </label>
            <input
              id="complaint-orderReference"
              {...text("orderReference")}
              maxLength={60}
              placeholder="Opcional"
              className={fieldClass}
              style={fieldStyle}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="complaint-incidentDate" className="text-sm font-medium">
              Fecha
            </label>
            <input
              id="complaint-incidentDate"
              {...text("incidentDate")}
              type="date"
              className={fieldClass}
              style={fieldStyle}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="complaint-itemDescription" className="text-sm font-medium">
            Descripción
          </label>
          <textarea
            id="complaint-itemDescription"
            {...text("itemDescription")}
            rows={2}
            maxLength={1000}
            className="w-full px-4 py-3 text-sm outline-none focus:ring-2"
            style={fieldStyle}
          />
          <ErrorText errors={fieldErrors.itemDescription} />
        </div>
      </Section>

      <Section number={3} title="Detalle">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tipo">
          {(
            [
              ["reclamo", "Reclamo", "No estás conforme con el producto o servicio."],
              ["queja", "Queja", "No estás conforme con la atención recibida."],
            ] as const
          ).map(([option, label, hint]) => (
            <label
              key={option}
              className="flex cursor-pointer flex-col gap-1 px-4 py-3 text-sm"
              style={{
                borderRadius: "var(--site-radius-chip)",
                border: `1px solid ${values.type === option ? "var(--site-primary)" : "var(--site-border-strong)"}`,
                background: values.type === option ? "var(--site-primary-soft)" : "transparent",
              }}
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="complaintType"
                  checked={values.type === option}
                  onChange={() => set("type", option)}
                  className="size-4"
                  style={{ accentColor: "var(--site-primary)" }}
                />
                {label}
              </span>
              <span className="text-xs" style={subtleStyle}>
                {hint}
              </span>
            </label>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="complaint-detail" className="text-sm font-medium">
            ¿Qué pasó?
          </label>
          <textarea
            id="complaint-detail"
            {...text("detail")}
            rows={5}
            maxLength={3000}
            className="w-full px-4 py-3 text-sm outline-none focus:ring-2"
            style={fieldStyle}
          />
          <ErrorText errors={fieldErrors.detail} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="complaint-consumerRequest" className="text-sm font-medium">
            ¿Qué solicitas?
          </label>
          <textarea
            id="complaint-consumerRequest"
            {...text("consumerRequest")}
            rows={3}
            maxLength={2000}
            className="w-full px-4 py-3 text-sm outline-none focus:ring-2"
            style={fieldStyle}
          />
          <ErrorText errors={fieldErrors.consumerRequest} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="complaint-responseChannel" className="text-sm font-medium">
            ¿Cómo quieres recibir la respuesta?
          </label>
          <select
            id="complaint-responseChannel"
            {...text("responseChannel")}
            className={fieldClass}
            style={fieldStyle}
          >
            <option value="email">Por correo electrónico</option>
            <option value="address">En mi domicilio</option>
          </select>
        </div>
      </Section>

      <label className="flex items-start gap-3 text-sm leading-relaxed" style={mutedStyle}>
        <input
          type="checkbox"
          checked={values.acceptedDeclaration}
          onChange={(event) => set("acceptedDeclaration", event.target.checked)}
          className="mt-1 size-4 shrink-0"
          style={{ accentColor: "var(--site-primary)" }}
        />
        Declaro que la información es verdadera. La formulación del reclamo no impide acudir a otras
        vías de solución de controversias ni es requisito previo para interponer una denuncia ante
        el INDECOPI.
      </label>
      <ErrorText errors={fieldErrors.acceptedDeclaration} />

      {error !== null ? (
        <p role="alert" className="text-sm" style={{ color: "#dc2626" }}>
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={preview || pending || !values.acceptedDeclaration}
          className={buttonClass}
          style={primaryButtonStyle}
        >
          {pending ? "Registrando…" : "Registrar hoja de reclamación"}
        </button>
      </div>
    </form>
  );
}
