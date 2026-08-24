import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Product-ready draft, NOT a final legal document — per explicit Phase 12
 * instruction: "لا تخترع صياغات قانونية دقيقة على أنها استشارة قانونية
 * نهائية... يجب مراجعتها قانونيًا قبل الإطلاق التجاري الرسمي." Content
 * below describes ONLY real, verified system behavior (RLS tenant
 * isolation, Supabase Auth, no card required for trial) — no invented
 * data-processing claims.
 */
export const metadata: Metadata = {
  title: "سياسة الخصوصية — راصد",
  description: "كيف يتعامل راصد مع بيانات المدرسين وطلابهم.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">سياسة الخصوصية</h1>
      <p className="mt-2 text-sm text-text-tertiary">آخر تحديث: هذه نسخة أولية قيد المراجعة القانونية.</p>

      <div className="mt-8 flex flex-col gap-6 text-text-secondary">
        <Section title="البيانات التي نجمعها">
          <p>
            عند إنشاء حساب، نجمع بريدك الإلكتروني واسمك. عند استخدامك للمنتج، تُخزَّن بيانات مساحة عملك — الطلاب، أولياء الأمور،
            المجموعات، الحضور، الواجبات، الاختبارات، والبيانات المالية — لتشغيل الخدمة التي طلبتها فقط.
          </p>
        </Section>

        <Section title="كيف نحفظ بياناتك">
          <p>
            كل مساحة عمل معزولة تمامًا عن غيرها على مستوى قاعدة البيانات — لا يمكن لأي مساحة عمل الوصول لبيانات مساحة أخرى.
            التحقق من الهوية يتم عبر مزوّد مصادقة متخصص (Supabase Auth)، ولا نخزّن كلمات المرور بأنفسنا.
          </p>
        </Section>

        <Section title="من يستطيع الوصول لبياناتك">
          <p>
            أنت وأعضاء فريقك الذين تمنحهم صلاحية صريحة فقط. فريق راصد لا يصل لبيانات مساحة عملك التشغيلية إلا عند الحاجة
            الفنية لدعمك، وبما يخدم هذا الغرض فقط.
          </p>
        </Section>

        <Section title="بيانات الدفع">
          <p>
            معالجة الدفع تتم عبر مزوّد دفع خارجي متخصص (Paddle). لا نخزّن بيانات بطاقتك على خوادمنا.
          </p>
        </Section>

        <Section title="مدة الاحتفاظ بالبيانات">
          <p>
            تبقى بياناتك محفوظة طالما مساحة عملك نشطة. عند انتهاء الاشتراك، تبقى البيانات محفوظة في وضع قراءة فقط حتى
            التجديد أو حتى تطلب حذف حسابك.
          </p>
        </Section>

        <Section title="التواصل بخصوص الخصوصية">
          <p>لأي استفسار حول بياناتك، يمكنك التواصل معنا من صفحة الدعم.</p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
