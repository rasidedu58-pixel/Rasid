import { WHATSAPP_INTENT_MESSAGE, whatsappUrl } from "../../lib/marketing/whatsapp";

/**
 * Floating WhatsApp action — fixed at the bottom-left corner of every
 * marketing page. Server-rendered (a plain `<a>` — no client JS needed);
 * `target="_blank"` opens the WhatsApp handoff in a new tab/app.
 *
 * Restraint over flash:
 *  • Sits at a generous safe distance from the edges + safe-area-aware
 *    (`env(safe-area-inset-*)`) so it never fights an iOS home indicator or
 *    a phone's edge gesture zone.
 *  • Subtle shadow + very light brand ring; a soft hover lift only.
 *  • No bounce/pulse; no scroll-triggered wiggle. `motion-reduce:transition-none`
 *    disables the tiny lift entirely for reduced-motion viewers.
 *  • Uses the WhatsApp brand green (accessibility-tested contrast on the
 *    white logo) — not overriding it with the Rasid teal would misread the
 *    icon; the surrounding site chrome carries our identity.
 *  • Compact on mobile (44×44 tap target), a touch larger on ≥sm (52×52) —
 *    never large enough to shadow a CTA below it.
 */
export function WhatsappFab() {
  return (
    <a
      href={whatsappUrl()}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`راسلنا على واتساب — ${WHATSAPP_INTENT_MESSAGE}`}
      className="focus-ring group fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] z-40 flex h-11 w-11 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg ring-1 ring-black/10 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:brightness-[1.05] active:scale-[0.97] sm:bottom-6 sm:left-6 sm:h-[52px] sm:w-[52px] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      {/* Official WhatsApp glyph, inlined so we don't fetch an external asset.
          The two subtle white paths are the standard mark from the brand
          guidelines (phone handset + dialogue bubble). */}
      <svg
        aria-hidden
        viewBox="0 0 32 32"
        className="h-6 w-6 sm:h-7 sm:w-7"
        fill="currentColor"
      >
        <path d="M16.001 3.2c-7.07 0-12.8 5.73-12.8 12.8 0 2.256.593 4.44 1.72 6.36L3.2 28.8l6.61-1.732a12.72 12.72 0 006.19 1.578h.005c7.07 0 12.8-5.73 12.8-12.8s-5.735-12.646-12.804-12.646zm0 23.312h-.004a10.61 10.61 0 01-5.41-1.482l-.388-.23-3.923 1.028 1.048-3.822-.253-.393a10.59 10.59 0 01-1.624-5.61c0-5.865 4.775-10.64 10.646-10.64 2.843 0 5.514 1.109 7.523 3.121a10.57 10.57 0 013.117 7.524c0 5.866-4.775 10.5-10.732 10.5zm5.83-7.86c-.32-.16-1.892-.933-2.185-1.04-.293-.107-.507-.16-.72.16-.213.32-.826 1.04-1.013 1.253-.187.213-.373.24-.693.08-.32-.16-1.348-.497-2.567-1.583-.949-.845-1.588-1.888-1.775-2.208-.187-.32-.02-.493.14-.653.144-.144.32-.373.48-.56.16-.187.213-.32.32-.533.107-.213.053-.4-.027-.56-.08-.16-.72-1.733-.987-2.373-.26-.624-.524-.54-.72-.55l-.613-.011a1.17 1.17 0 00-.853.4c-.293.32-1.12 1.093-1.12 2.666 0 1.573 1.147 3.093 1.307 3.306.16.213 2.253 3.44 5.463 4.824.764.33 1.36.527 1.824.674.766.244 1.464.21 2.015.128.615-.092 1.892-.774 2.16-1.52.267-.746.267-1.386.187-1.52-.08-.133-.293-.213-.613-.373z" />
      </svg>
      {/* Screen-reader-only extra hint. */}
      <span className="sr-only">فتح محادثة واتساب</span>
    </a>
  );
}
