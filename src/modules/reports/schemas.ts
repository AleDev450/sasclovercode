/**
 * Validation for what a report was asked for.
 *
 * The only input this phase takes: a range and an optional branch, both from
 * the query string. There is nothing to write, so there is no other schema -
 * which is the shape of a module that only reads.
 *
 * The range is NORMALISED rather than rejected. A report is reached by a URL
 * somebody can edit, and answering "the dates are the wrong way round" with an
 * error page is worse than answering with the range between them.
 */

import { z } from "zod";
import { RANGE_PRESETS } from "./ranges";

export const reportFiltersSchema = z.object({
  from: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim().length === 0 ? null : value)),
  to: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim().length === 0 ? null : value)),
  /** A shortcut wins over an explicit range: it is what the person just clicked. */
  preset: z
    .enum(RANGE_PRESETS)
    .optional()
    .transform((value) => value ?? null),
  location: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim().length === 0) return null;
      // An unparseable branch becomes "every branch" rather than an error: the
      // report is still the right answer to a slightly wrong question.
      return z.uuid().safeParse(value).success ? value : null;
    }),
});

export type ReportFilters = z.output<typeof reportFiltersSchema>;

/** How many rows the "top" reports return. Not a user input: a screen decision. */
export const TOP_LIMIT = 15;
