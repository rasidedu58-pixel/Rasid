import type { Metadata } from "next";
import { FAQ_ITEMS } from "../../../lib/marketing/faq-config";
import { FaqAccordion } from "../../../components/marketing/faq-accordion";

export const metadata: Metadata = {
  title: "الأسئلة الشائعة — راصد",
  description: "إجابات عن أكثر الأسئلة شيوعًا حول تجربة راصد المجانية، الباقات، والصلاحيات.",
  alternates: { canonical: "/faq" },
};

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-20">
      <p className="text-center text-sm font-semibold tracking-wide text-brand">الأسئلة الشائعة</p>
      <h1 className="mt-3 text-center text-3xl font-bold tracking-tight text-text-primary sm:text-4xl">
        كل ما تريد معرفته عن راصد
      </h1>
      <div className="mt-10">
        <FaqAccordion items={FAQ_ITEMS} defaultOpen={0} />
      </div>
    </div>
  );
}
