import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@academic-precision/ui";
import { WHATSAPP_INTENT_MESSAGE, whatsappUrl } from "../../../lib/marketing/whatsapp";

export const metadata: Metadata = {
  title: "الدعم — راصد",
  description: "تواصل مع فريق دعم راصد عبر واتساب.",
  alternates: { canonical: "/support" },
  robots: { index: true, follow: true },
};

/**
 * Support entry — deliberately compact. WhatsApp is the ONLY channel we
 * offer today (a monitored inbox does not exist yet; a placeholder mailto
 * would misrepresent our real response capacity). The card carries: title,
 * one-line trust description, a strong WhatsApp CTA, and the visible number
 * for anyone who prefers to save it locally. Nothing more — no invented
 * response-time promises, no fabricated "24/7", no fake account-manager.
 */
export default function SupportPage() {
  const href = whatsappUrl();
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
      <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">تواصل معنا عبر واتساب</h1>
      <p className="mt-3 text-text-secondary">
        لأي استفسار عن الباقات، حسابك، أو أي مشكلة تواجهها.
      </p>

      <Card className="mt-8">
        <CardContent className="flex flex-col items-center gap-4 py-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-sm">
            <svg aria-hidden viewBox="0 0 32 32" className="h-7 w-7" fill="currentColor">
              <path d="M16.001 3.2c-7.07 0-12.8 5.73-12.8 12.8 0 2.256.593 4.44 1.72 6.36L3.2 28.8l6.61-1.732a12.72 12.72 0 006.19 1.578h.005c7.07 0 12.8-5.73 12.8-12.8s-5.735-12.646-12.804-12.646zm0 23.312h-.004a10.61 10.61 0 01-5.41-1.482l-.388-.23-3.923 1.028 1.048-3.822-.253-.393a10.59 10.59 0 01-1.624-5.61c0-5.865 4.775-10.64 10.646-10.64 2.843 0 5.514 1.109 7.523 3.121a10.57 10.57 0 013.117 7.524c0 5.866-4.775 10.5-10.732 10.5zm5.83-7.86c-.32-.16-1.892-.933-2.185-1.04-.293-.107-.507-.16-.72.16-.213.32-.826 1.04-1.013 1.253-.187.213-.373.24-.693.08-.32-.16-1.348-.497-2.567-1.583-.949-.845-1.588-1.888-1.775-2.208-.187-.32-.02-.493.14-.653.144-.144.32-.373.48-.56.16-.187.213-.32.32-.533.107-.213.053-.4-.027-.56-.08-.16-.72-1.733-.987-2.373-.26-.624-.524-.54-.72-.55l-.613-.011a1.17 1.17 0 00-.853.4c-.293.32-1.12 1.093-1.12 2.666 0 1.573 1.147 3.093 1.307 3.306.16.213 2.253 3.44 5.463 4.824.764.33 1.36.527 1.824.674.766.244 1.464.21 2.015.128.615-.092 1.892-.774 2.16-1.52.267-.746.267-1.386.187-1.52-.08-.133-.293-.213-.613-.373z" />
            </svg>
          </div>

          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`ابدأ محادثة واتساب — ${WHATSAPP_INTENT_MESSAGE}`}
            className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#25D366] px-6 text-sm font-semibold text-white shadow-sm transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <svg aria-hidden viewBox="0 0 32 32" className="h-4 w-4" fill="currentColor">
              <path d="M16.001 3.2c-7.07 0-12.8 5.73-12.8 12.8 0 2.256.593 4.44 1.72 6.36L3.2 28.8l6.61-1.732a12.72 12.72 0 006.19 1.578h.005c7.07 0 12.8-5.73 12.8-12.8s-5.735-12.646-12.804-12.646zm5.83 15.452c-.32-.16-1.892-.933-2.185-1.04-.293-.107-.507-.16-.72.16-.213.32-.826 1.04-1.013 1.253-.187.213-.373.24-.693.08-.32-.16-1.348-.497-2.567-1.583-.949-.845-1.588-1.888-1.775-2.208-.187-.32-.02-.493.14-.653.144-.144.32-.373.48-.56.16-.187.213-.32.32-.533.107-.213.053-.4-.027-.56-.08-.16-.72-1.733-.987-2.373-.26-.624-.524-.54-.72-.55l-.613-.011a1.17 1.17 0 00-.853.4c-.293.32-1.12 1.093-1.12 2.666 0 1.573 1.147 3.093 1.307 3.306.16.213 2.253 3.44 5.463 4.824.764.33 1.36.527 1.824.674.766.244 1.464.21 2.015.128.615-.092 1.892-.774 2.16-1.52.267-.746.267-1.386.187-1.52-.08-.133-.293-.213-.613-.373z" />
            </svg>
            <span>راسلنا على واتساب</span>
          </a>
        </CardContent>
      </Card>

      <p className="mt-6 text-sm text-text-tertiary">
        قد تجد إجابتك أسرع في{" "}
        <Link href="/faq" className="font-medium text-brand hover:underline">
          الأسئلة الشائعة
        </Link>
        .
      </p>
    </div>
  );
}
