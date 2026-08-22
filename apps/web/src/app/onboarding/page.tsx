"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { onboardingCompleteRequestSchema, type DueDatePolicy } from "@academic-precision/contracts";
import { ApiRequestError, completeOnboarding } from "../../lib/api-client";
import { getSupabaseClient } from "../../lib/supabase-client";

type OnboardingState = "loading-session" | "idle" | "saving" | "completed" | "skipped";

/**
 * Owner onboarding shell (PRD §29.3). Short form only: display name,
 * optional subjects, due-date policy. No group/month is required here.
 * "Skip" and "Complete" both leave onboarding in Phase 1 — there is no
 * Action Center/Create Month yet to land on (later phase), so both simply
 * confirm and stop here; this is a documented Phase 1 scope limit, not a
 * missing feature bug.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState>("loading-session");
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [subjects, setSubjects] = useState("");
  const [dueDatePolicy, setDueDatePolicy] = useState<DueDatePolicy>("PER_GROUP");
  const [unifiedDueDay, setUnifiedDueDay] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (!data.session) {
        router.replace("/login");
        return;
      }
      setAccessToken(data.session.access_token);
      setState("idle");
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  function buildPayload() {
    return {
      displayName: displayName.trim(),
      subjects: subjects
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      dueDatePolicy,
      unifiedDueDay:
        dueDatePolicy === "UNIFIED" && unifiedDueDay !== "" ? Number(unifiedDueDay) : undefined,
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

    if (!accessToken) {
      router.replace("/login");
      return;
    }

    setState("saving");
    try {
      await completeOnboarding(accessToken, parsed.data);
      setState("completed");
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.code === "SESSION_EXPIRED" || error.code === "UNAUTHENTICATED") {
          router.replace("/login?expired=1");
          return;
        }
        if (error.code === "VALIDATION_ERROR") {
          setErrorMessage("بيانات غير صالحة. راجع الحقول أعلاه.");
          setState("idle");
          return;
        }
      }
      setErrorMessage("تعذر حفظ الإعداد الأولي. حاول مرة أخرى.");
      setState("idle");
    }
  }

  function onSkip() {
    setState("skipped");
  }

  if (state === "loading-session") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-8">
        <p className="text-slate-600">جارٍ التحميل...</p>
      </main>
    );
  }

  if (state === "completed" || state === "skipped") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">
          {state === "completed" ? "تم إعداد مساحة عملك" : "تم تخطي الإعداد الأولي"}
        </h1>
        <p className="text-slate-600">يمكنك إضافة المساعدين لاحقًا من فريق العمل والصلاحيات.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
      <h1 className="text-xl font-semibold">الإعداد الأولي</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1 text-sm">
          اسم العرض
          <input
            className="rounded border border-slate-300 p-2"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
          {fieldErrors.displayName?.map((msg) => (
            <span key={msg} className="text-xs text-red-600">
              {msg}
            </span>
          ))}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          المواد الدراسية (اختياري، مفصولة بفاصلة)
          <input
            className="rounded border border-slate-300 p-2"
            type="text"
            value={subjects}
            onChange={(e) => setSubjects(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          سياسة تاريخ الاستحقاق
          <select
            className="rounded border border-slate-300 p-2"
            value={dueDatePolicy}
            onChange={(e) => setDueDatePolicy(e.target.value as DueDatePolicy)}
          >
            <option value="PER_GROUP">حسب كل مجموعة</option>
            <option value="UNIFIED">موحّد لكل المجموعات</option>
          </select>
        </label>

        {dueDatePolicy === "UNIFIED" ? (
          <label className="flex flex-col gap-1 text-sm">
            يوم الاستحقاق الموحّد (1 - 28)
            <input
              className="rounded border border-slate-300 p-2"
              type="number"
              min={1}
              max={28}
              value={unifiedDueDay}
              onChange={(e) => setUnifiedDueDay(e.target.value)}
            />
            {fieldErrors.unifiedDueDay?.map((msg) => (
              <span key={msg} className="text-xs text-red-600">
                {msg}
              </span>
            ))}
          </label>
        ) : null}

        {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={state === "saving"}
            className="flex-1 rounded bg-slate-900 p-2 text-white disabled:opacity-50"
          >
            {state === "saving" ? "جارٍ الحفظ..." : "إكمال الإعداد"}
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={state === "saving"}
            className="flex-1 rounded border border-slate-300 p-2"
          >
            تخطي الآن
          </button>
        </div>
      </form>
    </main>
  );
}
