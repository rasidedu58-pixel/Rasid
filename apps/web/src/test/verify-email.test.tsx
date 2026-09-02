import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const verifyOtpMock = vi.fn();
const resendMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("../lib/supabase-client", () => ({
  getSupabaseClient: () => ({
    auth: {
      verifyOtp: verifyOtpMock,
      resend: resendMock,
    },
  }),
}));

let workspaceStatus: "loading" | "ready" | "no-workspace" | "error" = "no-workspace";
// A brand-new owner's /me PROVISIONS their workspace, so post-verify the resolved
// status is "ready" with an incomplete profile — which is what routes them to
// Step-2 onboarding (shouldForceTeacherOnboarding). These mirror useWorkspace's
// real fields so the redirect effect can be exercised faithfully.
let wsIsOwner = true;
let wsIsPlatformStaff = false;
let wsProfileCompleted = false;
vi.mock("../lib/workspace-provider", () => ({
  useWorkspace: () => ({ status: workspaceStatus, isOwner: wsIsOwner, isPlatformStaff: wsIsPlatformStaff, profileCompleted: wsProfileCompleted }),
}));

let searchParamsEmail: string | null = "teacher@example.com";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  useSearchParams: () => ({ get: (key: string) => (key === "email" ? searchParamsEmail : null) }),
}));

beforeEach(() => {
  verifyOtpMock.mockReset();
  resendMock.mockReset();
  replaceMock.mockReset();
  searchParamsEmail = "teacher@example.com";
  workspaceStatus = "no-workspace";
  wsIsOwner = true;
  wsIsPlatformStaff = false;
  wsProfileCompleted = false;
});

// vitest doesn't register RTL's auto-cleanup unless `test.globals` is on
// (it isn't, project-wide) — without this, unmounted renders from earlier
// tests in this file stay in the DOM and `getByText` starts matching more
// than one element.
afterEach(cleanup);

async function enterCode(code: string) {
  const inputs = screen.getAllByRole("textbox");
  code.split("").forEach((digit, i) => {
    fireEvent.change(inputs[i]!, { target: { value: digit } });
  });
}

describe("VerifyEmailPage", () => {
  it("shows a clear missing-email state instead of crashing when the email query param is absent (e.g. a page refresh)", async () => {
    searchParamsEmail = null;
    const { default: VerifyEmailPage } = await import("../app/verify-email/page");
    render(<VerifyEmailPage />);

    expect(screen.getByText(/تعذّر تحديد البريد الإلكتروني/)).toBeTruthy();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("verifies a correct 6-digit code via verifyOtp({ type: 'email' }) and redirects a NEW user to /onboarding", async () => {
    verifyOtpMock.mockResolvedValue({ data: {}, error: null });
    // A new owner's first /me provisions their workspace, so WorkspaceProvider
    // resolves "ready" with an incomplete profile → Step-2 onboarding.
    workspaceStatus = "ready";
    wsIsOwner = true;
    wsIsPlatformStaff = false;
    wsProfileCompleted = false;
    const { default: VerifyEmailPage } = await import("../app/verify-email/page");
    render(<VerifyEmailPage />);

    await enterCode("123456");
    fireEvent.click(screen.getByText("تأكيد البريد"));

    await waitFor(() => expect(verifyOtpMock).toHaveBeenCalledWith({ email: "teacher@example.com", token: "123456", type: "email" }));
    await waitFor(() => expect(screen.getByText("تم تأكيد بريدك الإلكتروني")).toBeTruthy());
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/onboarding"));
  });

  it("redirects to /dashboard instead when the workspace already exists (existing source of truth, no new frontend logic)", async () => {
    verifyOtpMock.mockResolvedValue({ data: {}, error: null });
    // Returning owner with a COMPLETE profile → straight to the app, no onboarding.
    workspaceStatus = "ready";
    wsProfileCompleted = true;
    const { default: VerifyEmailPage } = await import("../app/verify-email/page");
    render(<VerifyEmailPage />);

    await enterCode("654321");
    fireEvent.click(screen.getByText("تأكيد البريد"));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/dashboard"));
  });

  it("shows an Arabic error and does not redirect for an invalid code", async () => {
    verifyOtpMock.mockResolvedValue({ data: {}, error: { message: "Token has invalid format" } });
    const { default: VerifyEmailPage } = await import("../app/verify-email/page");
    render(<VerifyEmailPage />);

    await enterCode("000000");
    fireEvent.click(screen.getByText("تأكيد البريد"));

    await waitFor(() => expect(screen.getByText("الرمز الذي أدخلته غير صحيح.")).toBeTruthy());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("shows a distinct Arabic message for an expired code", async () => {
    verifyOtpMock.mockResolvedValue({ data: {}, error: { message: "Token has expired or is invalid" } });
    const { default: VerifyEmailPage } = await import("../app/verify-email/page");
    render(<VerifyEmailPage />);

    await enterCode("111111");
    fireEvent.click(screen.getByText("تأكيد البريد"));

    await waitFor(() => expect(screen.getByText("انتهت صلاحية الرمز. اطلب رمزًا جديدًا.")).toBeTruthy());
  });

  it("resends the code successfully via resend({ type: 'signup' }) and starts a visible cooldown", async () => {
    resendMock.mockResolvedValue({ data: {}, error: null });
    const { default: VerifyEmailPage } = await import("../app/verify-email/page");
    render(<VerifyEmailPage />);

    fireEvent.click(screen.getByText("إعادة إرسال الرمز"));

    await waitFor(() => expect(resendMock).toHaveBeenCalledWith({ type: "signup", email: "teacher@example.com" }));
    await waitFor(() => expect(screen.getByText("تم إرسال رمز جديد إلى بريدك الإلكتروني.")).toBeTruthy());
    expect(screen.getByText(/إعادة إرسال الرمز \(\d+\)/)).toBeTruthy();
  });

  it("shows an Arabic error and allows retry when resend fails", async () => {
    resendMock.mockResolvedValue({ data: {}, error: { message: "Too many requests" } });
    const { default: VerifyEmailPage } = await import("../app/verify-email/page");
    render(<VerifyEmailPage />);

    fireEvent.click(screen.getByText("إعادة إرسال الرمز"));

    await waitFor(() => expect(screen.getByText("تعذّر إرسال الرمز. حاول مرة أخرى.")).toBeTruthy());
    // No cooldown started on failure — the button must still say the same label, ready to retry.
    expect(screen.getByText("إعادة إرسال الرمز")).toBeTruthy();
  });
});
