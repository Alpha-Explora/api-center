import type { z } from "zod";

/** The first message per top-level field, for showing under each form row. */
export function fieldErrors(error: z.ZodError | undefined): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {};
  for (const issue of error?.issues ?? []) {
    const field = issue.path[0];
    if (typeof field === "string" && errors[field] === undefined) errors[field] = issue.message;
  }
  return errors;
}
