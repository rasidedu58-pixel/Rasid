import type { Metadata } from "next";
import Link from "next/link";
import { PricingTable } from "../../../components/marketing/pricing-table";
import { TRIAL_DAYS } from "../../../lib/marketing/pricing-config";

export const metadata: Metadata = {
  title: "الأسعار — راصد",
  description: "باقات راصد حسب سعة عدد الطلاب. تجربة مجانية 14 يومًا بدون بطاقة ائتمان في كل باقة.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">باقات حسب سعة طلابك</h1>
        <p className="mt-3 text-text-secondary">
          تختار الباقة حسب عدد طلابك، لا حسب عدد المجموعات — كل باقة تتضمن كل مزايا راصد الأساسية بلا استثناء.
        </p>
        <p className="mt-1 text-sm text-text-tertiary">تجربة مجانية {TRIAL_DAYS} يومًا في كل باقة، بدون بطاقة ائتمان.</p>
      </div>

      <PricingTable />

      <div className="mx-auto mt-16 max-w-2xl rounded-lg border border-border bg-surface-sunken p-6 text-center">
        <p className="text-sm text-text-secondary">
          الأسعار المعروضة أولية وقابلة للتعديل. زر كل باقة يبدأ تجربتك المجانية الآن — سيتم التواصل معك بخصوص تفعيل الباقة المناسبة عند نهاية التجربة.
          لأي استفسار عن باقتك،{" "}
          <Link href="/support" className="font-medium text-brand hover:underline">
            تواصل معنا
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
