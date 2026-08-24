import type { Metadata } from "next";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Button, Card, CardContent } from "@academic-precision/ui";

/**
 * KNOWN GAP, flagged in the Phase 12 closure report: no real support
 * inbox/channel exists anywhere in this project's configuration — this
 * placeholder address must be replaced with a real, monitored one before
 * commercial launch. Not fabricated as a working automated contact form
 * (no backend endpoint exists to receive one) — a plain mailto is the
 * only honest option available today.
 */
const SUPPORT_EMAIL = "support@rasid.app";

export const metadata: Metadata = {
  title: "الدعم — راصد",
  description: "تواصل مع فريق دعم راصد.",
  alternates: { canonical: "/support" },
  robots: { index: true, follow: true },
};

export default function SupportPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
      <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">نحن هنا للمساعدة</h1>
      <p className="mt-3 text-text-secondary">
        لأي استفسار عن الباقات، حسابك، أو أي مشكلة تواجهها، راسلنا وسنرد عليك في أقرب وقت.
      </p>

      <Card className="mt-8">
        <CardContent className="flex flex-col items-center gap-4 py-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-subtle">
            <Mail className="h-6 w-6 text-brand" aria-hidden />
          </div>
          <Button asChild size="lg">
            <Link href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</Link>
          </Button>
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
