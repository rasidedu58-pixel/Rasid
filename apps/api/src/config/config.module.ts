import { Global, Module } from "@nestjs/common";
import { loadApiEnv } from "./env";

export const API_ENV = "API_ENV";

/**
 * Global config module exposing the zod-validated environment as a
 * injectable provider, so services never read `process.env` directly.
 */
@Global()
@Module({
  providers: [
    {
      provide: API_ENV,
      useValue: loadApiEnv(),
    },
  ],
  exports: [API_ENV],
})
export class ConfigModule {}
