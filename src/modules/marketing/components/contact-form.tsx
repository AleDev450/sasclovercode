"use client";

import { useActionState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { BUSINESS_TYPES, CONTACT_SOURCES, HONEYPOT_FIELD, type ContactSource } from "../contact";
import { submitContactAction } from "../server/actions";

function FieldError({ id, messages }: { id: string; messages?: readonly string[] }) {
  if (messages === undefined || messages.length === 0) return null;
  return (
    <p id={id} className="text-destructive text-sm">
      {messages[0]}
    </p>
  );
}

export interface ContactFormProps {
  /** Recorded on the lead, so the funnel can be attributed to a section. */
  source?: ContactSource;
}

/**
 * The landing page contact form.
 *
 * ON SUCCESS THE FORM IS REPLACED, not merely annotated. A thank-you banner
 * above a form still full of the visitor's details invites them to press the
 * button again, and the second submission is indistinguishable from the first
 * once it reaches the inbox.
 */
export function ContactForm({ source = CONTACT_SOURCES.CONTACT }: ContactFormProps) {
  const [state, formAction, isPending] = useActionState(submitContactAction, IDLE_FORM_STATE);
  const fieldErrors = state.fieldErrors ?? {};

  if (state.status === "success") {
    return (
      <Alert variant="success">
        <AlertTitle>Mensaje enviado</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="source" value={source} />

      {/*
        The honeypot. `aria-hidden` and `tabIndex={-1}` keep it away from
        assistive technology and the keyboard, so the only thing that can reach
        it is a script filling every input on the page. The wrapper is hidden
        with a utility rather than `type="hidden"`, because a hidden input is
        exactly what a bot knows to leave alone.
      */}
      <div aria-hidden className="hidden">
        <label htmlFor={HONEYPOT_FIELD}>No completes este campo</label>
        <input
          id={HONEYPOT_FIELD}
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {state.status === "error" && state.message !== undefined ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="contact-name">Nombre y apellido</Label>
          <Input
            id="contact-name"
            name="name"
            required
            maxLength={120}
            autoComplete="name"
            placeholder="Maria Quispe"
            invalid={fieldErrors.name !== undefined}
            aria-describedby={fieldErrors.name !== undefined ? "contact-name-error" : undefined}
          />
          <FieldError id="contact-name-error" messages={fieldErrors.name} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="contact-email">Correo</Label>
          <Input
            id="contact-email"
            name="email"
            type="email"
            required
            maxLength={160}
            autoComplete="email"
            placeholder="maria@minegocio.pe"
            invalid={fieldErrors.email !== undefined}
            aria-describedby={fieldErrors.email !== undefined ? "contact-email-error" : undefined}
          />
          <FieldError id="contact-email-error" messages={fieldErrors.email} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="contact-phone">
            WhatsApp <span className="text-muted-foreground font-normal">(opcional)</span>
          </Label>
          <Input
            id="contact-phone"
            name="phone"
            type="tel"
            maxLength={40}
            autoComplete="tel"
            placeholder="+51 900 000 000"
            invalid={fieldErrors.phone !== undefined}
            aria-describedby={fieldErrors.phone !== undefined ? "contact-phone-error" : undefined}
          />
          <FieldError id="contact-phone-error" messages={fieldErrors.phone} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="contact-business">
            Nombre del negocio <span className="text-muted-foreground font-normal">(opcional)</span>
          </Label>
          <Input
            id="contact-business"
            name="businessName"
            maxLength={160}
            autoComplete="organization"
            placeholder="Bodega San Martin"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="contact-type">Rubro</Label>
        <Select id="contact-type" name="businessType" defaultValue="">
          <option value="">Selecciona tu rubro</option>
          {BUSINESS_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="contact-message">
          Cuentanos de tu negocio{" "}
          <span className="text-muted-foreground font-normal">(opcional)</span>
        </Label>
        <Textarea
          id="contact-message"
          name="message"
          maxLength={2000}
          placeholder="Tengo dos locales y vendo por WhatsApp. Necesito controlar el stock y sacar boletas."
          invalid={fieldErrors.message !== undefined}
          aria-describedby={
            fieldErrors.message !== undefined ? "contact-message-error" : "contact-message-help"
          }
        />
        <FieldError id="contact-message-error" messages={fieldErrors.message} />
        <p id="contact-message-help" className="text-muted-foreground text-xs">
          Mientras mas nos cuentes, mas concreta sera la demostracion.
        </p>
      </div>

      <Button
        type="submit"
        variant="brand"
        size="lg"
        loading={isPending}
        loadingLabel="Enviando"
        className="w-full sm:w-auto sm:self-start"
      >
        Quiero una demostracion
      </Button>

      <p className="text-muted-foreground text-xs">
        Usamos tus datos unicamente para contactarte sobre el servicio. No los compartimos con
        terceros.
      </p>
    </form>
  );
}
