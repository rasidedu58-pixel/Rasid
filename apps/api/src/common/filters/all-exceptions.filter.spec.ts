import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException, type ArgumentsHost } from "@nestjs/common";

const mockCapture = jest.fn();
jest.mock("@academic-precision/observability", () => ({
  captureException: (...args: unknown[]) => mockCapture(...args),
  createLogger: () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }),
}));

// Imported AFTER the mock so the module-level logger + captureException bind to the mock.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AllExceptionsFilter, shouldReportToSentry } = require("./all-exceptions.filter");

describe("shouldReportToSentry (Phase 15G)", () => {
  it("reports unexpected (non-HttpException) errors", () => {
    expect(shouldReportToSentry(500, false)).toBe(true);
  });
  it("reports explicit 5xx HttpExceptions", () => {
    expect(shouldReportToSentry(500, true)).toBe(true);
    expect(shouldReportToSentry(503, true)).toBe(true);
  });
  it("never reports expected 4xx product behaviour (400/401/403/404/409/429)", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      expect(shouldReportToSentry(status, true)).toBe(false);
    }
  });
});

describe("AllExceptionsFilter — Sentry forwarding", () => {
  const send = jest.fn();
  const status = jest.fn(() => ({ send }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ headers: { "x-request-id": "req_test" }, url: "/api/v1/students?q=secret", method: "GET" }),
    }),
  } as unknown as ArgumentsHost;

  beforeEach(() => {
    mockCapture.mockClear();
    send.mockClear();
    status.mockClear();
  });

  it("captures an unexpected error to Sentry with safe context only (query stripped)", () => {
    new AllExceptionsFilter().catch(new Error("boom"), host);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    const [, ctx] = mockCapture.mock.calls[0];
    expect(ctx).toEqual({ requestId: "req_test", route: "/api/v1/students", method: "GET", status: 500 });
    expect(status).toHaveBeenCalledWith(500);
  });

  it("captures an explicit 5xx HttpException", () => {
    new AllExceptionsFilter().catch(new InternalServerErrorException(), host);
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it("does NOT capture expected 4xx (400/404/409)", () => {
    new AllExceptionsFilter().catch(new BadRequestException(), host);
    new AllExceptionsFilter().catch(new NotFoundException(), host);
    new AllExceptionsFilter().catch(new ConflictException(), host);
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
