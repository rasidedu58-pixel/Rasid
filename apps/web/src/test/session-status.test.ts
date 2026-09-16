import { describe, expect, it } from "vitest";
import { deriveSessionDisplay, primaryActionLabel } from "../app/(app)/sessions/session-status";

/**
 * Session lifecycle display derivation — the display-only refinement of the
 * five stored statuses into the operations-facing lifecycle. These tests pin
 * the exact time-window semantics owners approved (Phase 3): the boundary is
 * EXACT (`now >= end`) with NO grace period, and a stored IN_PROGRESS whose
 * slot has ended is «فائتة — لم تُسجَّل» — never still-ongoing.
 *
 * Times are UTC-fixed via absolute `Date` values so the tests pass
 * regardless of the machine timezone; nothing here depends on a client
 * timezone conversion.
 */
function iso(minutesFromEpoch: number): string {
  return new Date(minutesFromEpoch * 60_000).toISOString();
}

const START = iso(1_000_000); // arbitrary anchor
const NOW_BEFORE = new Date((1_000_000 - 60) * 60_000); // 60 min before start
const NOW_AT_START = new Date(1_000_000 * 60_000); // exact start
const NOW_DURING = new Date((1_000_000 + 30) * 60_000); // 30 min into a 60-min session
const NOW_AT_END = new Date((1_000_000 + 60) * 60_000); // exact end (60-min slot)
const NOW_AFTER_END = new Date((1_000_000 + 61) * 60_000); // 1 min past end

describe("deriveSessionDisplay — Temporal × Operational state model", () => {
  it("upcoming — future SCHEDULED > 30 min away", () => {
    const d = deriveSessionDisplay({ status: "SCHEDULED", scheduledAt: START, durationMinutes: 60 }, NOW_BEFORE);
    expect(d.key).toBe("upcoming");
    expect(d.label).toBe("قادمة");
    expect(d.live).toBe(false);
  });

  it("soon — SCHEDULED within 30 min of start", () => {
    const now = new Date((1_000_000 - 15) * 60_000);
    const d = deriveSessionDisplay({ status: "SCHEDULED", scheduledAt: START, durationMinutes: 60 }, now);
    expect(d.key).toBe("soon");
  });

  it("ready — SCHEDULED whose slot has arrived but was never started (boundary: start included)", () => {
    const d = deriveSessionDisplay({ status: "SCHEDULED", scheduledAt: START, durationMinutes: 60 }, NOW_AT_START);
    expect(d.key).toBe("ready");
    expect(d.label).toBe("جاهزة للتسجيل");
    expect(d.live).toBe(true);
  });

  it("ready — SCHEDULED mid-window (never started)", () => {
    const d = deriveSessionDisplay({ status: "SCHEDULED", scheduledAt: START, durationMinutes: 60 }, NOW_DURING);
    expect(d.key).toBe("ready");
  });

  it("in_progress — IN_PROGRESS mid-window", () => {
    const d = deriveSessionDisplay({ status: "IN_PROGRESS", scheduledAt: START, durationMinutes: 60 }, NOW_DURING);
    expect(d.key).toBe("in_progress");
    expect(d.label).toBe("جارية");
    expect(d.live).toBe(true);
  });

  it("in_progress — IN_PROGRESS exactly at start (boundary included)", () => {
    const d = deriveSessionDisplay({ status: "IN_PROGRESS", scheduledAt: START, durationMinutes: 60 }, NOW_AT_START);
    expect(d.key).toBe("in_progress");
  });

  it("missed — IN_PROGRESS whose slot has EXACTLY ended (no grace period)", () => {
    // Owner directive (Phase 1, rule 1): «إذا انتهى الوقت، تخرج من الجارية
    // الآن فورًا، حتى لو ظلت `IN_PROGRESS` في قاعدة البيانات». The
    // boundary is `now >= end` — this is the reproduction of the exact
    // Monday→Wednesday production bug at t=end.
    const d = deriveSessionDisplay({ status: "IN_PROGRESS", scheduledAt: START, durationMinutes: 60 }, NOW_AT_END);
    expect(d.key).toBe("missed");
    expect(d.label).toBe("فائتة — لم تُسجَّل");
    expect(d.live).toBe(false);
  });

  it("missed — IN_PROGRESS past end", () => {
    const d = deriveSessionDisplay({ status: "IN_PROGRESS", scheduledAt: START, durationMinutes: 60 }, NOW_AFTER_END);
    expect(d.key).toBe("missed");
  });

  it("missed — SCHEDULED past end (never started)", () => {
    const d = deriveSessionDisplay({ status: "SCHEDULED", scheduledAt: START, durationMinutes: 60 }, NOW_AFTER_END);
    expect(d.key).toBe("missed");
  });

  it("completed — never regresses to missed even after the window ends", () => {
    // Rule 3 of Phase 3: a completed session stays completed regardless
    // of the clock.
    const d = deriveSessionDisplay({ status: "COMPLETED", scheduledAt: START, durationMinutes: 60 }, NOW_AFTER_END);
    expect(d.key).toBe("completed");
  });

  it("cancelled — terminal, never derived to missed", () => {
    const d = deriveSessionDisplay({ status: "CANCELLED", scheduledAt: START, durationMinutes: 60 }, NOW_AFTER_END);
    expect(d.key).toBe("cancelled");
  });

  it("rescheduled — terminal, never derived to missed", () => {
    const d = deriveSessionDisplay({ status: "RESCHEDULED", scheduledAt: START, durationMinutes: 60 }, NOW_AFTER_END);
    expect(d.key).toBe("rescheduled");
  });

  it("owner's exact repro — Monday 7:19 PM (60 min) session on Wednesday is missed, NOT in_progress", () => {
    // Anchor: Monday 2026-09-14 at 19:19 UTC. 60-min slot ends 20:19.
    // Now: Wednesday 2026-09-16 12:00 UTC. The old code kept this
    // IN_PROGRESS → wrongly "current session"; new derivation must say missed.
    const monday = new Date("2026-09-14T19:19:00Z").toISOString();
    const wednesday = new Date("2026-09-16T12:00:00Z");
    const d = deriveSessionDisplay({ status: "IN_PROGRESS", scheduledAt: monday, durationMinutes: 60 }, wednesday);
    expect(d.key).toBe("missed");
    expect(d.label).toBe("فائتة — لم تُسجَّل");
    expect(d.live).toBe(false);
  });

  it("owner's exact repro — same day, DIFFERENT session actually in its window on Wednesday shows in_progress correctly", () => {
    const wednesdayStart = new Date("2026-09-16T11:30:00Z").toISOString();
    const wednesdayNow = new Date("2026-09-16T12:00:00Z");
    const d = deriveSessionDisplay({ status: "IN_PROGRESS", scheduledAt: wednesdayStart, durationMinutes: 60 }, wednesdayNow);
    expect(d.key).toBe("in_progress");
  });

  it("primaryActionLabel — missed sessions read «تسجيل الحصة الآن», never «استكمال التسجيل»", () => {
    expect(primaryActionLabel("missed")).toBe("تسجيل الحصة الآن");
    expect(primaryActionLabel("ready")).toBe("بدء الحصة");
    expect(primaryActionLabel("in_progress")).toBe("العودة للحصة");
    expect(primaryActionLabel("upcoming")).toBe("بدء الحصة");
  });

  it("partial-attendance case — an IN_PROGRESS session past its end derives as `missed`; nothing in derivation removes records, and the derivation is purely a display refinement", () => {
    // Owner directive (Phase 15, Section 3): a teacher who began
    // recording but did not finish before the slot ended must (a) see an
    // honest state that is NOT «جارية», (b) keep every already-written
    // record, and (c) be able to complete via the normal review path.
    //
    // `deriveSessionDisplay` is a pure function returning a display key
    // and label. It has no side effects — it cannot delete records,
    // cannot change `sessions.status` in the database, and cannot force
    // completion. Its only responsibility is to say «فائتة — لم تُسجَّل»
    // (and thereby signal to the session page's banner + primary CTA)
    // instead of «جارية». This test pins that pure-function contract.
    const start = new Date("2026-09-14T19:19:00Z").toISOString();
    const laterOnWednesday = new Date("2026-09-16T12:00:00Z");
    const d = deriveSessionDisplay({ status: "IN_PROGRESS", scheduledAt: start, durationMinutes: 60 }, laterOnWednesday);
    expect(d.key).toBe("missed");
    expect(d.label).toBe("فائتة — لم تُسجَّل");
    // Non-live: the "الحصة الجارية الآن" surface must not treat this session as live.
    expect(d.live).toBe(false);
    // And the primary action must invite the teacher to complete the
    // recording rather than call it done or forbid it.
    expect(primaryActionLabel(d.key)).toBe("تسجيل الحصة الآن");
  });
});
