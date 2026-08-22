import { Injectable, type NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Correlation/request-id middleware. Attaches `X-Request-Id` to every
 * response, reusing an inbound header value when present and generating a
 * new `req_<uuid>` otherwise.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    const inbound = req.headers[REQUEST_ID_HEADER];
    const requestId = (Array.isArray(inbound) ? inbound[0] : inbound) ?? `req_${randomUUID()}`;

    req.headers[REQUEST_ID_HEADER] = requestId;
    res.setHeader("X-Request-Id", requestId);
    next();
  }
}
