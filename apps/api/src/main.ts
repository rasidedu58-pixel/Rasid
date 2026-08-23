import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { RequestContextInterceptor } from "./common/interceptors/request-context.interceptor";

const API_PREFIX = "api/v1";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new RequestContextInterceptor());

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
  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.removeContentTypeParser("application/json");
  fastifyInstance.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body: string, done) => {
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
      "Phase 0 infrastructure (health/readiness) + Phase 1 identity/auth/workspace " +
        "endpoints (GET /me, GET /me/workspaces/:id/context, POST /onboarding/complete). " +
        "No later-phase business feature endpoints are exposed yet.",
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
