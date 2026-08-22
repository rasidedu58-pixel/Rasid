import { z } from "zod";

/**
 * Shared API error contract, aligned with API Contract v1.0:
 *
 * {
 *   "error": { "code": "STRING_CODE", "message": "human message", "details": {} },
 *   "requestId": "req_..."
 * }
 *
 * No domain DTOs live here — only the stable envelope shape shared by every
 * endpoint in apps/api and consumed by apps/web.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
  requestId: z.string(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export type ApiErrorBody = ApiError["error"];
