/**
 * Validation for what an audit page was asked for.
 *
 * The only input this phase takes, and it all comes from the query string. This
 * module has no Server Action and therefore no write schema - the audit is
 * written by triggers and read by nobody else (ADR-028 decision 1).
 *
 * NORMALISED rather than rejected, the same posture Phase 23 took: an audit
 * screen is reached by a URL people edit and share, and answering a slightly
 * wrong question with an error page is worse than answering the question.
 */

import { z } from "zod";
import { AUDIT_ACTIONS } from "./actions";

/** One page of history. Enough to scan, small enough to render. */
export const AUDIT_PAGE_SIZE = 50;

/**
 * How far back the screen looks by default.
 *
 * Not a hard limit on the data - the table keeps everything (KL-2402) - just
 * what a page with no dates shows. Thirty days is the window in which somebody
 * asks "who changed this?"; older questions arrive with a date attached.
 */
export const AUDIT_DEFAULT_DAYS = 30;

export const auditFiltersSchema = z.object({
  action: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim().length === 0) return null;
      // An unknown action becomes "every action". A filter that matched nothing
      // would render an empty page indistinguishable from "nothing happened",
      // which on an audit screen is the one wrong answer to give.
      return (AUDIT_ACTIONS as readonly string[]).includes(value)
        ? (value as (typeof AUDIT_ACTIONS)[number])
        : null;
    }),
  entity: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim().length === 0) return null;
      return z.uuid().safeParse(value).success ? value : null;
    }),
  page: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = Number.parseInt(value ?? "", 10);
      return Number.isFinite(parsed) && parsed > 1 ? parsed : 1;
    }),
});

export type AuditFilters = z.output<typeof auditFiltersSchema>;
