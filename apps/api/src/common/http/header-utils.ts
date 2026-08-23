import type { FastifyRequest } from "fastify";

/** Reads a single header value, normalizing Fastify's `string | string[] | undefined` into `string | null`. */
export function extractHeader(request: FastifyRequest, headerName: string): string | null {
  const value = request.headers[headerName];
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved ?? null;
}
