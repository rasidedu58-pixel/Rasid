import type { ZodError } from "zod";

/** Shared zod-issue → API Contract `details.fieldErrors` mapper (mirrors TeamService's private helper). */
export function toFieldErrors(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_root";
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }
  return fieldErrors;
}
