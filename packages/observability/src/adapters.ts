/**
 * Sentry/OpenTelemetry-ready adapter interfaces.
 *
 * These are intentionally no-op stubs in Phase 0. Real Sentry/OTel wiring
 * is introduced once credentials/collector endpoints exist; nothing here
 * requires a live DSN or collector to build/lint/typecheck/test.
 */
export type ErrorReporter = {
  captureException(error: unknown, context?: Record<string, unknown>): void;
};

export type TraceSpan = {
  end(): void;
};

export type Tracer = {
  startSpan(name: string, context?: Record<string, unknown>): TraceSpan;
};

export function createNoopErrorReporter(): ErrorReporter {
  return {
    captureException(_error, _context) {
      // Intentionally no-op until Sentry is wired with real credentials.
    },
  };
}

export function createNoopTracer(): Tracer {
  return {
    startSpan(_name, _context) {
      return {
        end() {
          // Intentionally no-op until OpenTelemetry is wired.
        },
      };
    },
  };
}
