import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { loadServerEnv } from "@academic-precision/config";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { RequestContextInterceptor } from "./common/interceptors/request-context.interceptor";

/**
 * Phase 11 — apps/web (a distinct browser origin: Vercel) needs CORS to
 * call this API (Railway) at all; there was previously no CORS
 * configuration anywhere in this app, which silently blocks every
 * cross-origin browser request (server-to-server calls, curl, Swagger's
 * "Try it out" from the API's own origin were never affected — this is a
 * browser-enforced restriction, not a server one, which is why it went
 * unnoticed through Phases 1-10's own API-only test suites).
 *
 * `CORS_ALLOWED_ORIGINS` is a comma-separated allowlist (never a wildcard —
 * this API is called with `Authorization: Bearer` + a custom
 * `X-Workspace-Id` header, and credentialed/header-bearing cross-origin
 * requests require an explicit origin, not `*`). Unset falls back to the
 * local dev web app's own default port only — never "allow everything" —
 * so a misconfigured production deploy fails closed (blocks the real
 * frontend, loudly) rather than open.
 */
function resolveAllowedOrigins(): string[] {
  const { CORS_ALLOWED_ORIGINS } = loadServerEnv();
  if (!CORS_ALLOWED_ORIGINS) return ["http://localhost:3001"];
  return CORS_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

const API_PREFIX = "api/v1";

async function bootstrap() {
  // `trustProxy: true` — Phase 10: the app is deployed behind a reverse
  // proxy/load balancer in every real environment (Render, or any future
  // container host per ADR-012's portability requirement); without this,
  // Fastify's `req.ip` resolves to the proxy's own address for every
  // request, which would make the rate limiter (ThrottlerGuard, keyed by
  // client IP) treat all traffic as a single client instead of isolating
  // abusive callers. Harmless locally (no proxy present, `req.ip` still
  // resolves to the direct connection).
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }));

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new RequestContextInterceptor());
  app.enableCors({
    origin: resolveAllowedOrigins(),
    credentials: false, // Bearer token in a header, never a cookie — no credentialed-cookie mode needed.
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Workspace-Id", "Idempotency-Key"],
  });

  // Nest/Fastify only register their own default JSON content-type parser
  // during `app.init()` (triggered internally by `app.listen()`), so a
  // replacement parser can only be installed AFTER that point — installing
  // it earlier (e.g. right after NestFactory.create()) collides with
  // Nest's own registration ("already present"). Initialize explicitly
  // first so we can safely override afterwards.
  await app.init();

  // Fastify's default JSON content-type parser throws a raw
  // FST_ERR_CTP_EMPTY_JSON_BODY (surfaced as an opaque 500, bypassing our
  // error contract) for any request that sends `Content-Type:
  // application/json` with an empty body — a real client mistake for
  // bodyless POST endpoints (e.g. `/sessions/:id/cancel`), not a server
  // bug, but real HTTP clients do this. Treat an empty JSON body as `{}`
  // rather than a parse error; downstream DTO validation (zod) still
  // rejects it cleanly with VALIDATION_ERROR if the endpoint actually
  // requires fields.
  //
  // Phase 8: also stashes the exact raw body string on `req.rawBody`
  // BEFORE JSON.parse — `POST /webhooks/paddle` needs the untransformed
  // bytes for HMAC signature verification (API Contract §11.16 step 1;
  // re-serializing a parsed JSON object never reproduces the original
  // byte-for-byte string, which would make every signature check fail
  // unpredictably). Harmless for every other route — `rawBody` is simply
  // unused there.
  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.removeContentTypeParser("application/json");
  fastifyInstance.addContentTypeParser("application/json", { parseAs: "string" }, (req, body: string, done) => {
    (req as unknown as { rawBody?: string }).rawBody = body;
    if (body.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Academic Precision API")
    .setDescription(
      "Teacher V1 API — identity/auth/workspace, RBAC, scheduling, students, session mode, " +
        "finance, attention/follow-up, billing/entitlements, reports, notifications, and the " +
        "Action Center (Phases 1-9). Every route is rate-limited (Phase 10) — see response " +
        "headers for the caller's remaining quota.",
    )
    .setVersion("v1")
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" })
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
  // eslint-disable-next-line no-console
  console.log(`Academic Precision API listening on port ${port} (prefix: /${API_PREFIX})`);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to bootstrap Academic Precision API:", error);
  process.exit(1);
});
