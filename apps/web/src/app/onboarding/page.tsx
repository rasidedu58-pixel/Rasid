"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { onboardingCompleteRequestSchema, type DueDatePolicy } from "@academic-precision/contracts";
import { Button, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@academic-precision/ui";
import { ApiRequestError, isSessionExpired, isValidationError } from "../../lib/api/client";
import { completeOnboarding } from "../../lib/api/identity";
import { useSession } from "../../lib/session-provider";
import { AuthCard } from "../../components/auth/auth-card";

type OnboardingState = "idle" | "saving";

/**
 * Owner onboarding (PRD §29.3). Short form only: display name, optional
 * subjects, due-date policy — no group/month is required here. Both
 * "Complete" and "Skip" land on the real Dashboard now (Phase 11) — the
 * backend already auto-provisions a default workspace on first
 * authenticated request (`IdentityService.ensureProvisioned`), so skipping
 * this refinement step never blocks using the product.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const [state, setState] = useState<OnboardingState>("idle");

  const [displayName, setDisplayName] = useState("");
  const [subjects, setSubjects] = useState("");
  const [dueDatePolicy, setDueDatePolicy] = useState<DueDatePolicy>("PER_GROUP");
  const [unifiedDueDay, setUnifiedDueDay] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStatus === "unauthenticated") router.replace("/login");
  }, [sessionStatus, router]);

  function buildPayload() {
    return {
      displayName: displayName.trim(),
      subjects: subjects
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      dueDatePolicy,
      unifiedDueDay: dueDatePolicy === "UNIFIED" && unifiedDueDay !== "" ? Number(unifiedDueDay) : undefined,
    };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setFieldErrors({});

    const payload = buildPayload();
    const parsed = onboardingCompleteRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_root";
        errors[key] = [...(errors[key] ?? []), issue.message];
      }
      setFieldErrors(errors);
      return;
    }

    setState("saving");
    try {
      await completeOnboarding(parsed.data);
      router.push("/dashboard");
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (isSessionExpired(error)) {
          router.replace("/login?expired=1");
          return;
        }
        if (isValidationError(error)) {
          setErrorMessage("بيانات غير صالحة. راجع الحقول أعلاه.");
          setState("idle");
          return;
        }
      }
      setErrorMessage("تعذّر حفظ الإعداد الأولي. حاول مرة أخرى.");
      setState("idle");
    }
  }

  if (sessionStatus === "loading" || sessionStatus === "unauthenticated") {
    return (
      <AuthCard title="جارٍ التحميل...">
        <div />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="الإعداد الأولي" description="خطوة سريعة لتجهيز مساحة عملك.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="اسم العرض" htmlFor="displayName" error={fieldErrors.displayName?.[0]}>
          <Input id="displayName" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required invalid={!!fieldErrors.displayName} />
        </Field>

        <Field label="المواد الدراسية" htmlFor="subjects" hint="اختياري، مفصولة بفاصلة.">
          <Input id="subjects" type="text" value={subjects} onChange={(e) => setSubjects(e.target.value)} placeholder="رياضيات، فيزياء" />
        </Field>

        <Field label="سياسة تاريخ الاستحقاق" htmlFor="dueDatePolicy">
          <Select value={dueDatePolicy} onValueChange={(v) => setDueDatePolicy(v as DueDatePolicy)}>
            <SelectTrigger id="dueDatePolicy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PER_GROUP">حسب كل مجموعة</SelectItem>
              <SelectItem value="UNIFIED">موحّد لكل المجموعات</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {dueDatePolicy === "UNIFIED" ? (
          <Field label="يوم الاستحقاق الموحّد" htmlFor="unifiedDueDay" hint="من 1 إلى 28." error={fieldErrors.unifiedDueDay?.[0]}>
            <Input id="unifiedDueDay" type="number" min={1} max={28} value={unifiedDueDay} onChange={(e) => setUnifiedDueDay(e.target.value)} invalid={!!fieldErrors.unifiedDueDay} />
          </Field>
        ) : null}

        {errorMessage ? (
          <p className="text-sm text-danger" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-1 flex gap-2">
          <Button type="submit" loading={state === "saving"} className="flex-1">
            إكمال الإعداد
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/dashboard")} disabled={state === "saving"} className="flex-1">
            تخطي الآن
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
