"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { FaqAccordion, type FaqAccordionItem } from "./faq-accordion";

/** FAQ with a live client-side search over question + answer text (RTL). */
export function FaqSearch({ items }: { items: FaqAccordionItem[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim();
    if (!term) return items;
    return items.filter((i) => `${i.question} ${i.answer}`.includes(term));
  }, [q, items]);

  return (
    <div>
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute end-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث في الأسئلة…"
          aria-label="ابحث في الأسئلة الشائعة"
          className="focus-ring h-11 w-full rounded-xl border border-border bg-surface pe-11 ps-4 text-sm text-text-primary placeholder:text-text-tertiary transition-colors"
        />
      </div>

      {filtered.length > 0 ? (
        <FaqAccordion key={q} items={filtered} defaultOpen={q ? -1 : 0} />
      ) : (
        <p className="rounded-xl border border-border bg-surface px-5 py-8 text-center text-sm text-text-secondary">
          لا توجد نتائج مطابقة لبحثك.
        </p>
      )}
    </div>
  );
}
