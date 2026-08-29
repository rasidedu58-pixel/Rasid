"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";

export interface FaqAccordionItem {
  question: string;
  answer: string;
}

/**
 * Premium FAQ accordion — smooth open/close via the CSS grid-rows technique
 * (globals.css `.rasid-accordion-panel`), full ARIA (`aria-expanded`,
 * `aria-controls`, `role="region"`), keyboard-native (real `<button>`), and
 * RTL-correct. First item can start open. `prefers-reduced-motion` disables
 * the height transition (handled in CSS).
 */
export function FaqAccordion({ items, defaultOpen = 0 }: { items: FaqAccordionItem[]; defaultOpen?: number }) {
  const [open, setOpen] = useState<number | null>(defaultOpen);
  const baseId = useId();

  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {items.map((item, i) => {
        const isOpen = open === i;
        const btnId = `${baseId}-q-${i}`;
        const panelId = `${baseId}-a-${i}`;
        return (
          <div key={item.question}>
            <h3>
              <button
                type="button"
                id={btnId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen(isOpen ? null : i)}
                className="focus-ring flex w-full items-center justify-between gap-4 px-5 py-4 text-start transition-colors hover:bg-surface-sunken/60"
              >
                <span className="font-medium text-text-primary">{item.question}</span>
                <Plus
                  className={`h-4 w-4 shrink-0 text-brand transition-transform duration-300 ${isOpen ? "rotate-45" : ""}`}
                  aria-hidden
                />
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={btnId}
              className="rasid-accordion-panel"
              data-open={isOpen}
            >
              <div className="rasid-accordion-inner">
                <p className="px-5 pb-5 text-sm leading-relaxed text-text-secondary">{item.answer}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
