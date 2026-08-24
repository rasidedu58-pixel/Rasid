import { AlertOctagon } from "lucide-react";

/**
 * Deployment Closure Delta — rendered instead of the app crashing when
 * required runtime configuration (`NEXT_PUBLIC_SUPABASE_URL`/
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY`) is missing. This is an operator-facing
 * message (the person who deploys/configures the app), not a normal
 * end-user error — deliberately says exactly what is misconfigured rather
 * than a generic "something went wrong", since the fix is always the same
 * (set the env vars in the hosting platform and redeploy).
 */
export function ConfigErrorScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-sunken px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-danger-subtle">
        <AlertOctagon className="h-7 w-7 text-danger" aria-hidden />
      </div>
      <div className="flex max-w-md flex-col gap-2">
        <h1 className="text-lg font-semibold text-text-primary">التطبيق غير مُهيّأ بشكل صحيح</h1>
        <p className="text-sm text-text-secondary">
          متغيرات البيئة الخاصة بالاتصال (NEXT_PUBLIC_SUPABASE_URL وNEXT_PUBLIC_SUPABASE_ANON_KEY) غير مُعرَّفة في بيئة النشر الحالية. راجع إعدادات البيئة على منصة الاستضافة ثم أعد النشر.
        </p>
      </div>
    </div>
  );
}
