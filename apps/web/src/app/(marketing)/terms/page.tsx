import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TRIAL_DAYS } from "../../../lib/marketing/pricing-config";

/**
 * Product-ready draft, NOT a final legal document — see privacy/page.tsx's
 * identical disclaimer. Describes only real, verified behavior (14-day
 * trial without a card, read-only state after expiry).
 */
export const metadata: Metadata = {
  title: "الشروط والأحكام — راصد",
  description: "شروط استخدام منصة راصد.",
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">الشروط والأحكام</h1>
      <p className="mt-2 text-sm text-text-tertiary">آخر تحديث: هذه نسخة أولية قيد المراجعة القانونية.</p>

      <div className="mt-8 flex flex-col gap-6 text-text-secondary">
        <Section title="استخدام الخدمة">
          <p>راصد نظام تشغيل ومتابعة للمدرسين وأصحاب المجموعات التعليمية. باستخدامك للخدمة، أنت توافق على استخدامها لهذا الغرض فقط.</p>
        </Section>

        <Section title="التجربة المجانية">
          <p>تحصل على تجربة مجانية {TRIAL_DAYS} يومًا عند إنشاء حسابك، دون الحاجة لإدخال بيانات بطاقة ائتمان.</p>
        </Section>

        <Section title="الاشتراك والدفع">
          <p>
            بعد انتهاء التجربة، يستمر استخدام المنتج بالاشتراك في إحدى الباقات المتاحة. معالجة الدفع تتم عبر مزوّد دفع
            خارجي متخصص.
          </p>
        </Section>

        <Section title="ماذا يحدث عند انتهاء الاشتراك أو فشل الدفع">
          <p>
            تتحول مساحة عملك لوضع القراءة فقط — تستطيع مراجعة بياناتك القديمة، لكن الإجراءات التشغيلية الجديدة (تسجيل حصص،
            حضور، تحصيل مالي) تتوقف حتى تجديد الاشتراك. بياناتك لا تُحذف.
          </p>
        </Section>

        <Section title="مسؤوليتك عن بياناتك">
          <p>أنت مسؤول عن دقة البيانات التي تُدخلها (بيانات الطلاب وأولياء الأمور)، وعن الحفاظ على سرية بيانات دخولك.</p>
        </Section>

        <Section title="التعديلات على هذه الشروط">
          <p>قد تُحدَّث هذه الشروط من وقت لآخر. سنعلمك بأي تغيير جوهري.</p>
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
