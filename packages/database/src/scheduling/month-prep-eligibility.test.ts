import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { evaluateMonthActivation, evaluateMonthPrepEligibility } from "./month-prep-eligibility";

const TZ = "Africa/Cairo";
const AUG = { year: 2026, month: 8 };
const SEP = { year: 2026, month: 9 };
const OCT = { year: 2026, month: 10 };
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
const noOverride = { prepBlocked: false, earlyPrepAllowed: false };

// Window = last 7 days of August (Aug has 31 days) ⇒ opens Aug 25.
describe("evaluateMonthPrepEligibility", () => {
  it("bootstrap (no current month) → allowed as CURRENT, no window", () => {
    expect(evaluateMonthPrepEligibility({ current: null, target: AUG, now: at("2026-08-10T09:00"), timezone: TZ, windowDays: 7, override: noOverride, duplicateExists: false }))
      .toEqual({ allowed: true, status: "CURRENT" });
  });

  it("before the window → block (OUTSIDE_WINDOW)", () => {
    expect(evaluateMonthPrepEligibility({ current: AUG, target: SEP, now: at("2026-08-20T09:00"), timezone: TZ, windowDays: 7, override: noOverride, duplicateExists: false }))
      .toEqual({ allowed: false, reason: "OUTSIDE_WINDOW" });
  });

  it("inside the 7-day window → allowed as DRAFT (current stays)", () => {
    expect(evaluateMonthPrepEligibility({ current: AUG, target: SEP, now: at("2026-08-26T09:00"), timezone: TZ, windowDays: 7, override: noOverride, duplicateExists: false }))
      .toEqual({ allowed: true, status: "DRAFT" });
  });

  it("EARLY_PREP_ALLOWED before the window → allowed as DRAFT", () => {
    expect(evaluateMonthPrepEligibility({ current: AUG, target: SEP, now: at("2026-08-10T09:00"), timezone: TZ, windowDays: 7, override: { prepBlocked: false, earlyPrepAllowed: true }, duplicateExists: false }))
      .toEqual({ allowed: true, status: "DRAFT" });
  });

  it("PREP_BLOCKED → block even inside the window", () => {
    expect(evaluateMonthPrepEligibility({ current: AUG, target: SEP, now: at("2026-08-26T09:00"), timezone: TZ, windowDays: 7, override: { prepBlocked: true, earlyPrepAllowed: false }, duplicateExists: false }))
      .toEqual({ allowed: false, reason: "PREP_BLOCKED" });
  });

  it("both overrides → PREP_BLOCKED wins", () => {
    expect(evaluateMonthPrepEligibility({ current: AUG, target: SEP, now: at("2026-08-10T09:00"), timezone: TZ, windowDays: 7, override: { prepBlocked: true, earlyPrepAllowed: true }, duplicateExists: false }))
      .toEqual({ allowed: false, reason: "PREP_BLOCKED" });
  });

  it("skipping two months ahead → block (NOT_NEXT_MONTH)", () => {
    expect(evaluateMonthPrepEligibility({ current: AUG, target: OCT, now: at("2026-08-26T09:00"), timezone: TZ, windowDays: 7, override: { prepBlocked: false, earlyPrepAllowed: true }, duplicateExists: false }))
      .toEqual({ allowed: false, reason: "NOT_NEXT_MONTH" });
  });

  it("duplicate target → block (DUPLICATE)", () => {
    expect(evaluateMonthPrepEligibility({ current: AUG, target: SEP, now: at("2026-08-26T09:00"), timezone: TZ, windowDays: 7, override: noOverride, duplicateExists: true }))
      .toEqual({ allowed: false, reason: "DUPLICATE" });
  });

  it("catch-up: target month already started, no draft → allowed as CURRENT (create-and-start)", () => {
    expect(evaluateMonthPrepEligibility({ current: AUG, target: SEP, now: at("2026-09-03T09:00"), timezone: TZ, windowDays: 7, override: noOverride, duplicateExists: false }))
      .toEqual({ allowed: true, status: "CURRENT" });
  });
});

describe("evaluateMonthActivation", () => {
  it("blocks activating a non-DRAFT", () => {
    expect(evaluateMonthActivation({ draft: SEP, draftStatus: "CURRENT", current: AUG, now: at("2026-09-02T09:00"), timezone: TZ }))
      .toEqual({ allowed: false, reason: "NOT_DRAFT" });
  });

  it("blocks early activation before the target month begins", () => {
    expect(evaluateMonthActivation({ draft: SEP, draftStatus: "DRAFT", current: AUG, now: at("2026-08-28T09:00"), timezone: TZ }))
      .toEqual({ allowed: false, reason: "NOT_STARTED" });
  });

  it("blocks activating a month that isn't the immediate next", () => {
    expect(evaluateMonthActivation({ draft: OCT, draftStatus: "DRAFT", current: AUG, now: at("2026-10-02T09:00"), timezone: TZ }))
      .toEqual({ allowed: false, reason: "NOT_NEXT_MONTH" });
  });

  it("allows activating the next DRAFT once its month has begun", () => {
    expect(evaluateMonthActivation({ draft: SEP, draftStatus: "DRAFT", current: AUG, now: at("2026-09-01T00:05"), timezone: TZ }))
      .toEqual({ allowed: true });
  });
});
