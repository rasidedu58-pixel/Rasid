import type { Metadata } from "next";
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
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">باقات حسب سعة طلابك وحجم فريقك</h1>
        <p className="mt-3 text-text-secondary">
          اختر السعة المناسبة لعدد طلابك وحجم فريقك.
        </p>
        <p className="mt-1 text-sm text-text-tertiary">تجربة مجانية {TRIAL_DAYS} يومًا في كل باقة، بدون بطاقة ائتمان.</p>
      </div>

      <PricingTable />
    </div>
  );
}
