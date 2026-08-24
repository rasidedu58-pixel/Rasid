import type { Metadata } from "next";
import { FAQ_ITEMS } from "../../../lib/marketing/faq-config";

export const metadata: Metadata = {
  title: "الأسئلة الشائعة — راصد",
  description: "إجابات عن أكثر الأسئلة شيوعًا حول تجربة راصد المجانية، الباقات، والصلاحيات.",
  alternates: { canonical: "/faq" },
};

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-center text-3xl font-bold text-text-primary sm:text-4xl">الأسئلة الشائعة</h1>
      <div className="mt-10 flex flex-col divide-y divide-border rounded-lg border border-border">
        {FAQ_ITEMS.map((item) => (
          <div key={item.question} className="p-5">
            <h2 className="font-medium text-text-primary">{item.question}</h2>
            <p className="mt-2 text-sm text-text-secondary">{item.answer}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
