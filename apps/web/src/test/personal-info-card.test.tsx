import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";

/**
 * Settings → «البيانات الشخصية» must SHOW what was saved. The reported
 * symptom was «اختر المحافظة» on an account whose governorate and subject
 * were chosen at signup — these pin the display contract, so a regression in
 * how the profile reaches the selects is caught here rather than by a user.
 */
const fetchMeMock = vi.fn();
const updateMock = vi.fn();
vi.mock("../lib/api/identity", () => ({
  fetchMe: () => fetchMeMock(),
  updateTeacherProfile: (body: unknown) => updateMock(body),
}));

import { PersonalInfoCard } from "../app/(app)/settings/personal-info-card";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function me(profile: Partial<{ phone: string | null; governorate: string | null; subject: string | null; subjectOther: string | null }>) {
  return {
    user: { id: "u1", email: "t@example.com", fullName: "مدرس تجريبي" },
    profile: { phone: null, governorate: null, subject: null, subjectOther: null, profileCompleted: false, ...profile },
    memberships: [],
    platform: { isStaff: false },
  };
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PersonalInfoCard />
    </QueryClientProvider>,
  );
}

const trigger = (id: string) => document.getElementById(id)?.textContent ?? "";
const input = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";

describe("PersonalInfoCard", () => {
  it("shows the SAVED governorate and subject, not the placeholder", async () => {
    fetchMeMock.mockResolvedValue(me({ phone: "+201012345678", governorate: "CAIRO", subject: "MATH" }));
    renderCard();

    await waitFor(() => expect(input("fullName")).toBe("مدرس تجريبي"));
    expect(input("phone")).toBe("+201012345678");
    expect(trigger("governorate")).toBe("القاهرة");
    expect(trigger("subject")).toBe("الرياضيات");
    expect(trigger("governorate")).not.toContain("اختر");
    expect(trigger("subject")).not.toContain("اختر");
  });

  it("shows «اختر…» only when the value is genuinely absent", async () => {
    fetchMeMock.mockResolvedValue(me({ phone: null, governorate: null, subject: null }));
    renderCard();

    await waitFor(() => expect(input("fullName")).toBe("مدرس تجريبي"));
    expect(trigger("governorate")).toBe("اختر المحافظة");
    expect(trigger("subject")).toBe("اختر المادة");
  });

  it("renders the free-text subject field only for subject = OTHER, with its saved value", async () => {
    fetchMeMock.mockResolvedValue(me({ governorate: "ASWAN", subject: "OTHER", subjectOther: "التربية الموسيقية" }));
    renderCard();

    await waitFor(() => expect(trigger("subject")).toBe("أخرى"));
    expect(trigger("governorate")).toBe("أسوان");
    expect(input("subjectOther")).toBe("التربية الموسيقية");
  });

  it("every governorate the API can return has a label — no code can leak to the screen", async () => {
    const { EGYPT_GOVERNORATES, TEACHING_SUBJECTS } = await import("@academic-precision/contracts");
    for (const g of EGYPT_GOVERNORATES) expect(g.ar.trim().length).toBeGreaterThan(0);
    for (const s of TEACHING_SUBJECTS) expect(s.ar.trim().length).toBeGreaterThan(0);
  });
});
