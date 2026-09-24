import { describe, expect, it } from "vitest";
import { buildActionSections, sortByUrgency, SECTION_ITEM_CAP } from "../app/(app)/dashboard/action-sections";
import type { ActionItem } from "../app/(app)/dashboard/action-item-row";

function item(over: Partial<ActionItem> & { entityId: string }): ActionItem {
  return {
    entityType: "session",
    reason: "reason",
    urgency: "MEDIUM",
    nextAction: "افعل",
    ...over,
  };
}

describe("dashboard action sections — typed grouping", () => {
  it("folds missedSessions + missingRecords into ONE 'حصص تحتاج تسجيلًا' section", () => {
    const sections = buildActionSections({
      missedSessions: { items: [item({ entityId: "m1", urgency: "HIGH" })] },
      missingRecords: { items: [item({ entityId: "r1", urgency: "MEDIUM" })] },
    });
    expect(sections).toHaveLength(1);
    expect(sections[0]!.key).toBe("sessions");
    expect(sections[0]!.title).toBe("حصص تحتاج تسجيلًا");
    expect(sections[0]!.items.map((i) => i.entityId)).toEqual(["m1", "r1"]); // HIGH first
    expect(sections[0]!.viewAllHref).toBe("/sessions");
  });

  it("maps each remaining bucket to its own typed section with the right filtered href", () => {
    const sections = buildActionSections({
      attention: { items: [item({ entityType: "attention_case", entityId: "a1" })] },
      followUpsDue: { items: [item({ entityType: "scheduled_followup", entityId: "f1" })] },
      collection: { items: [item({ entityType: "financial_obligation", entityId: "c1" })] },
    });
    expect(sections.map((s) => s.key)).toEqual(["attention", "followups", "collection"]);
    expect(sections.find((s) => s.key === "attention")!.viewAllHref).toBe("/attention");
    expect(sections.find((s) => s.key === "followups")!.viewAllHref).toBe("/attention?tab=followups");
    expect(sections.find((s) => s.key === "collection")!.viewAllHref).toBe("/finance");
  });

  it("drops empty sections entirely (never 4 empty states)", () => {
    const sections = buildActionSections({
      attention: { items: [item({ entityId: "a1" })] },
      // no sessions/followups/collection
    });
    expect(sections.map((s) => s.key)).toEqual(["attention"]);
  });

  it("returns [] when every bucket is empty", () => {
    expect(buildActionSections({})).toEqual([]);
    expect(
      buildActionSections({ attention: { items: [] }, collection: { items: [] } }),
    ).toEqual([]);
  });

  it("keeps the fixed most-operational-first order regardless of which buckets are present", () => {
    const sections = buildActionSections({
      collection: { items: [item({ entityId: "c1" })] },
      followUpsDue: { items: [item({ entityId: "f1" })] },
      missedSessions: { items: [item({ entityId: "m1" })] },
      attention: { items: [item({ entityId: "a1" })] },
    });
    expect(sections.map((s) => s.key)).toEqual(["sessions", "attention", "followups", "collection"]);
  });
});

describe("sortByUrgency — HIGH first, stable", () => {
  it("orders HIGH → MEDIUM → LOW and preserves input order within a rank", () => {
    const ordered = sortByUrgency([
      item({ entityId: "1", urgency: "LOW" }),
      item({ entityId: "2", urgency: "HIGH" }),
      item({ entityId: "3", urgency: "MEDIUM" }),
      item({ entityId: "4", urgency: "HIGH" }),
    ]);
    expect(ordered.map((i) => i.entityId)).toEqual(["2", "4", "3", "1"]);
  });

  it("does not mutate the input array", () => {
    const input = [item({ entityId: "1", urgency: "LOW" }), item({ entityId: "2", urgency: "HIGH" })];
    const before = input.map((i) => i.entityId);
    sortByUrgency(input);
    expect(input.map((i) => i.entityId)).toEqual(before);
  });
});

describe("SECTION_ITEM_CAP", () => {
  it("caps at 3 (the UI shows a 'عرض الكل' link past this)", () => {
    expect(SECTION_ITEM_CAP).toBe(3);
  });
});
