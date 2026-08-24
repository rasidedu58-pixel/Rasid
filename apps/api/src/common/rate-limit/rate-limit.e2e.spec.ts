import { Controller, Get, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Throttle, ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

/**
 * Phase 10 — proves the `ThrottlerGuard` wiring itself actually enforces a
 * limit end-to-end (real Fastify request pipeline via `.inject()`, no real
 * socket bound), independent of `AppModule`'s specific tiers — a minimal,
 * isolated module is enough to prove the MECHANISM works; each real
 * controller's own `@Throttle(...)` values are exercised by the app's own
 * DI-graph/build checks, not re-tested here.
 */
@Controller("probe")
class ProbeController {
  @Get("tight")
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  tight(): { ok: true } {
    return { ok: true };
  }

  @Get("loose")
  loose(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 100 }])],
  controllers: [ProbeController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class ProbeModule {}

describe("Rate limiting (ThrottlerGuard) — end-to-end mechanism proof", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(ProbeModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("allows requests under the per-route limit", async () => {
    const instance = app.getHttpAdapter().getInstance();
    for (let i = 0; i < 3; i++) {
      const res = await instance.inject({ method: "GET", url: "/probe/tight" });
      expect(res.statusCode).toBe(200);
    }
  });

  it("blocks the request that exceeds the per-route limit with 429", async () => {
    const instance = app.getHttpAdapter().getInstance();
    // The 3-request budget from the previous test may already be consumed
    // (same IP, same window) — issue one more to guarantee we cross it here too.
    const res = await instance.inject({ method: "GET", url: "/probe/tight" });
    expect(res.statusCode).toBe(429);
  });

  it("a route with NO @Throttle override still uses the global default tier and is not blocked by the tight route's budget", async () => {
    const instance = app.getHttpAdapter().getInstance();
    const res = await instance.inject({ method: "GET", url: "/probe/loose" });
    expect(res.statusCode).toBe(200);
  });
});
