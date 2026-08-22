import { z } from "zod";

/**
 * Cursor pagination primitives shared across list endpoints.
 *
 * No domain DTO invention — `T` is supplied by the caller's own item schema
 * in a later phase.
 */
export const pageInfoSchema = z.object({
  nextCursor: z.string().nullable(),
  hasNext: z.boolean(),
});

export type PageInfo = z.infer<typeof pageInfoSchema>;

export type CursorPage<T> = {
  items: T[];
  page: PageInfo;
};

export function cursorPageSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    page: pageInfoSchema,
  });
}
