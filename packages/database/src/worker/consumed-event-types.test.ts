import { describe, expect, it } from "vitest";
import { WORKER_CONSUMED_EVENT_TYPES } from "./outbox-dispatcher";

/**
 * Guards the single source of truth shared by the worker's poll loop and the
 * platform health/queue metrics. If an event type is added here it MUST have a
 * real worker consumer — otherwise it would sit PENDING forever and (via this
 * shared list) wrongly count as a worker backlog. MonthCreated has no consumer
 * and must NOT be in this list.
 */
describe("WORKER_CONSUMED_EVENT_TYPES", () => {
  it("consumes SessionCompleted", () => {
    expect(WORKER_CONSUMED_EVENT_TYPES).toContain("SessionCompleted");
  });

  it("does NOT include unconsumed producer-only events like MonthCreated", () => {
    expect(WORKER_CONSUMED_EVENT_TYPES).not.toContain("MonthCreated");
  });
});
