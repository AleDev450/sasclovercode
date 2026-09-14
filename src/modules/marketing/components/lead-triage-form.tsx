"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Label, Select, Textarea } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import type { LeadStatus } from "@/types/database";
import { updateLeadAction } from "../server/lead-actions";

/** The funnel, in the order a lead moves through it. */
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "Sin atender",
  contacted: "Contactado",
  qualified: "Calificado",
  won: "Ganado",
  lost: "Perdido",
};

export interface LeadTriageFormProps {
  leadId: string;
  status: LeadStatus;
  internalNote: string | null;
}

/**
 * Triage controls for one lead.
 *
 * One form per row rather than a board with drag and drop: an operator working
 * this inbox is reading a message and then deciding, so the decision belongs
 * beside the message. A board would be prettier and would hide the text that
 * the decision depends on.
 */
export function LeadTriageForm({ leadId, status, internalNote }: LeadTriageFormProps) {
  const [state, formAction, isPending] = useActionState(updateLeadAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="leadId" value={leadId} />

      {state.status === "error" && state.message !== undefined ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`status-${leadId}`} className="text-xs">
          Estado
        </Label>
        <Select id={`status-${leadId}`} name="status" defaultValue={status}>
          {(Object.keys(LEAD_STATUS_LABEL) as LeadStatus[]).map((value) => (
            <option key={value} value={value}>
              {LEAD_STATUS_LABEL[value]}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`note-${leadId}`} className="text-xs">
          Nota interna
        </Label>
        <Textarea
          id={`note-${leadId}`}
          name="internalNote"
          rows={2}
          maxLength={2000}
          defaultValue={internalNote ?? ""}
          placeholder="Que se acordo, cuando volver a llamar..."
          className="text-sm"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" loading={isPending} loadingLabel="Guardando">
          Guardar
        </Button>
        {state.status === "success" ? (
          <span className="text-success text-xs font-medium">{state.message}</span>
        ) : null}
      </div>
    </form>
  );
}
