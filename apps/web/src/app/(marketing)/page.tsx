import type { Metadata } from "next";
import Link from "next/link";
import {
  Users,
  Layers,
  CalendarRange,
  CalendarClock,
  ClipboardCheck,
  NotebookPen,
  GraduationCap,
  HeartHandshake,
  Wallet,
  FileBarChart,
  Sparkles,
  Bell,
  ShieldCheck,
  KeyRound,
  History,
  Smartphone,
  ArrowLeft,
} from "lucide-react";
import { Badge, Button, Card, CardContent } from "@academic-precision/ui";
import { AuthenticatedRedirect } from "../../components/marketing/authenticated-redirect";
import { PricingTable } from "../../components/marketing/pricing-table";
import { FAQ_ITEMS } from "../../lib/marketing/faq-config";
import { TRIAL_DAYS } from "../../lib/marketing/pricing-config";

export const metadata: Metadata = {
  title: "راصد — نظام تشغيل ومتابعة للمدرسين وأصحاب المجموعات التعليمية",
  description: "راصد يجمع تسجيل الحضور والواجبات والمتابعة والتحصيل المالي لمجموعاتك التعليمية في مكان واحد. جرّبه مجانًا 14 يومًا بدون بطاقة.",
  alternates: { canonical: "/" },
};

const FEATURES = [
  { icon: Users, label: "الطلاب", description: "ملف كامل لكل طالب: بياناته، أولياء أموره، وسجله الدراسي والمالي." },
  { icon: Layers, label: "المجموعات", description: "مجموعاتك الدائمة بجدولها ورسومها، منظمة في مكان واحد." },
  { icon: CalendarRange, label: "الأشهر التشغيلية", description: "جهّز كل شهر تشغيلي بسرعة: الرسوم، الجدول، والطلاب المستمرون تلقائيًا." },
  { icon: CalendarClock, label: "الحصص", description: "جدول حصص يتولّد تلقائيًا من مواعيدك الأسبوعية." },
  { icon: ClipboardCheck, label: "الحضور", description: "تسجيل حضور سريع من الهاتف أثناء الحصة نفسها." },
  { icon: NotebookPen, label: "الواجبات", description: "تابع من أنجز الواجب ومن لم يُسجَّل له شيء بعد." },
  { icon: GraduationCap, label: "الاختبارات", description: "رصد درجات الاختبارات وربطها بملف كل طالب." },
  { icon: HeartHandshake, label: "المتابعة", description: "حالات تحتاج انتباهك تظهر تلقائيًا بسببها ودليلها." },
  { icon: Wallet, label: "المالية", description: "المستحقات والمدفوعات والمتأخرات لكل طالب ومجموعة." },
  { icon: FileBarChart, label: "التقارير", description: "تقارير جاهزة لكل طالب ومجموعة وللشهر كله." },
  { icon: Sparkles, label: "مركز الإجراءات", description: "كل ما يحتاج قرارك الآن، في شاشة واحدة عند فتح راصد." },
  { icon: Bell, label: "الإشعارات", description: "تنبيهات بما يحتاج متابعة قبل أن يفوتك." },
];

const HOW_IT_WORKS = [
  { step: "١", title: "أنشئ حسابك", description: "تسجيل مباشر بالبريد الإلكتروني، مع تحقق سريع برمز من 6 أرقام." },
  { step: "٢", title: "جهّز شهرك ومجموعاتك", description: "حدّد المجموعات النشطة هذا الشهر، رسومها، وجدولها الأسبوعي." },
  { step: "٣", title: "سجّل الحصص بسرعة", description: "حضور وواجبات ودرجات، كلها من الهاتف أثناء الحصة." },
  { step: "٤", title: "راصد يجمع ما يحتاج متابعة", description: "مركز الإجراءات يعرض لك كل ما يستحق قرارًا الآن، بلا بحث." },
  { step: "٥", title: "تابع الطلاب والتحصيل والتقارير", description: "صورة كاملة عن كل طالب ومجموعة وشهر، وقتما احتجتها." },
];

const TRUST_POINTS = [
  { icon: KeyRound, title: "فصل كامل بين مساحات العمل", description: "بيانات كل مدرس معزولة تمامًا عن غيره على مستوى قاعدة البيانات." },
  { icon: ShieldCheck, title: "صلاحيات دقيقة لكل عضو فريق", description: "تحدد أنت من يرى ماذا ومن يستطيع تعديل ماذا، مجموعة بمجموعة." },
  { icon: History, title: "سجل كامل للعمليات المالية", description: "كل دفعة ومستحق محفوظ ومرتبط بسجله، دون تعديل يمحو التاريخ." },
];

/**
 * Landing page (`/`) — the public marketing home. Server Component (no
 * "use client") except the two small client islands it composes
 * (`AuthenticatedRedirect`, and `MarketingHeader`'s mobile menu) — real
 * content is server-rendered for SEO/crawlability. Every feature listed
 * here is a real, shipped Teacher V1 capability (Phase 11) — nothing here
 * is aspirational.
 */
export default function LandingPage() {
  return (
    <>
      <AuthenticatedRedirect />
      <StructuredData />

      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* One soft brand-tinted wash behind the hero — depth without a heavy gradient. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-brand-subtle/40 to-transparent" />
        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="flex flex-col gap-6">
              <Badge tone="brand" className="w-fit">لأصحاب المجموعات التعليمية والمدرسين المستقلين</Badge>
              <h1 className="text-3xl font-bold leading-tight text-text-primary sm:text-4xl lg:text-5xl">
                مركز التشغيل اليومي لمجموعاتك التعليمية
              </h1>
              {/* The core product idea (§4), as a distinctive signature line. */}
              <OperatingRhythm />
              <p className="text-lg text-text-secondary">
                سجّل حضور طلابك وواجباتهم، افهم ما يحتاج قرارك الآن، اتخذ الإجراء، ثم تابع كل شيء — كل هذا في مكان واحد، بدلًا من دفاتر ومجموعات واتساب متفرقة.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link href="/signup">ابدأ تجربتك المجانية</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="#how-it-works">اكتشف كيف يعمل</Link>
                </Button>
              </div>
              <p className="text-sm text-text-tertiary">تجربة {TRIAL_DAYS} يومًا كاملة، بدون بطاقة ائتمان.</p>
            </div>

            <ProductPreviewPanel />
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="border-t border-border bg-surface-sunken py-16">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
          <h2 className="text-2xl font-bold text-text-primary sm:text-3xl">قبل راصد، كانت المتابعة تتفكك</h2>
          <p className="mt-4 text-text-secondary">
            دفتر حضور ورقي، رسالة واتساب لولي أمر، ورقة رسوم منفصلة، وذاكرة تحاول تجميع كل هذا معًا. كل شهر يبدأ من الصفر، وكل غياب أو دفعة متأخرة يسهل أن يضيع وسط الزحمة — ليس لأنك مقصّر، بل لأن الأدوات مبعثرة.
          </p>
          <p className="mt-3 font-medium text-text-primary">راصد يجمع التشغيل كله في مكان واحد، ويعرض لك ما يحتاج قرارك دون أن تبحث عنه.</p>
        </div>
      </section>

      {/* Product principle */}
      <section id="how-it-works" className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold text-text-primary sm:text-3xl">كيف يعمل راصد</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
          {HOW_IT_WORKS.map((item) => (
            <div key={item.step} className="flex flex-col gap-2 rounded-lg border border-border p-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-subtle text-sm font-bold text-brand">{item.step}</span>
              <p className="font-medium text-text-primary">{item.title}</p>
              <p className="text-sm text-text-secondary">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features — no card borders/shadows at all (the explicit "not
          every piece of content should be a card" direction, applied
          concretely): an icon chip + text, differentiated by generous
          whitespace only, not by 12 repeated boxes. Grid `divide-*`
          utilities were deliberately avoided here — they don't wrap
          correctly across a responsive 2-/3-column grid (a spurious
          border appears at the start of every new row). */}
      <section id="features" className="border-t border-border bg-surface-sunken py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold text-text-primary sm:text-3xl">كل ما تحتاجه لتشغيل مجموعاتك، جاهز اليوم</h2>
          </div>
          <div className="grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.label} className="flex flex-col gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-subtle">
                  <feature.icon className="h-[18px] w-[18px] text-brand" aria-hidden />
                </span>
                <p className="font-medium text-text-primary">{feature.label}</p>
                <p className="text-sm text-text-secondary">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who is it for */}
      <section className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
        <h2 className="text-2xl font-bold text-text-primary sm:text-3xl">راصد مبني اليوم من أجل</h2>
        <div className="mt-8 grid grid-cols-1 gap-4 text-start sm:grid-cols-3">
          <WhoCard title="المدرس المستقل" description="تدير كل شيء بنفسك، من التسجيل إلى التحصيل، من مكان واحد." />
          <WhoCard title="صاحب عدة مجموعات" description="عشرات الطلاب عبر مجموعات مختلفة، دون أن يضيع أي تفصيل." />
          <WhoCard title="المدرس مع مساعد أو فريق صغير" description="صلاحيات دقيقة تحدد من يرى ومن يعدّل ماذا." />
        </div>
        <p className="mt-8 flex items-center justify-center gap-2 text-sm text-text-tertiary">
          <Smartphone className="h-4 w-4" aria-hidden />
          نسخة المراكز التعليمية بفروع ومشرفين قادمة لاحقًا.
        </p>
      </section>

      {/* Pricing teaser */}
      <section className="border-t border-border bg-surface-sunken py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold text-text-primary sm:text-3xl">باقات حسب سعة طلابك</h2>
            <p className="mt-2 text-text-secondary">تجربة مجانية {TRIAL_DAYS} يومًا في كل باقة، بدون بطاقة ائتمان.</p>
          </div>
          <PricingTable />
          <div className="mt-8 text-center">
            <Link href="/pricing" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
              كل تفاصيل الباقات
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold text-text-primary sm:text-3xl">بياناتك في مكان آمن</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {TRUST_POINTS.map((point) => (
            <div key={point.title} className="flex flex-col gap-2 rounded-lg border border-border p-5">
              <point.icon className="h-6 w-6 text-brand" aria-hidden />
              <p className="font-medium text-text-primary">{point.title}</p>
              <p className="text-sm text-text-secondary">{point.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ preview */}
      <section className="border-t border-border bg-surface-sunken py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold text-text-primary sm:text-3xl">أسئلة شائعة</h2>
          </div>
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
            {FAQ_ITEMS.slice(0, 4).map((item) => (
              <div key={item.question} className="p-5">
                <p className="font-medium text-text-primary">{item.question}</p>
                <p className="mt-2 text-sm text-text-secondary">{item.answer}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 text-center">
            <Link href="/faq" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
              كل الأسئلة الشائعة
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
        <h2 className="text-2xl font-bold text-text-primary sm:text-3xl">ابدأ تشغيل مجموعاتك بشكل أوضح اليوم</h2>
        <p className="mt-3 text-text-secondary">تجربة {TRIAL_DAYS} يومًا كاملة، بدون بطاقة ائتمان.</p>
        <div className="mt-6">
          <Button asChild size="lg">
            <Link href="/signup">ابدأ تجربتك المجانية</Link>
          </Button>
        </div>
      </section>
    </>
  );
}

/** The سجّل → افهم → تصرّف → تابع rhythm as a compact right-to-left flow; arrows point in the reading direction. */
function OperatingRhythm() {
  const steps = ["سجّل", "افهم", "تصرّف", "تابع"];
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-base font-semibold">
      {steps.map((step, i) => (
        <span key={step} className="flex items-center gap-2.5">
          <span className="text-brand">{step}</span>
          {i < steps.length - 1 ? <ArrowLeft className="h-4 w-4 text-text-tertiary" aria-hidden /> : null}
        </span>
      ))}
    </div>
  );
}

function WhoCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-border p-5">
      <p className="font-medium text-text-primary">{title}</p>
      <p className="mt-2 text-sm text-text-secondary">{description}</p>
    </div>
  );
}

/**
 * A faithful, honest stand-in for a real product screenshot: built from
 * the SAME design tokens/labels the actual Dashboard uses (§ real feature
 * names, real "مركز الإجراءات" framing), not a generic stock illustration
 * or an invented mock UI. This session has no authenticated test account
 * to capture an actual screenshot with — documented as a known limitation
 * (see the Phase 12 closure report), not hidden.
 */
function ProductPreviewPanel() {
  return (
    <Card className="flex overflow-hidden shadow-floating">
      {/* A thin sliver of the REAL app shell (see components/shell/sidebar.tsx's
          --shell-* tokens) — not a generic browser-chrome mockup — so this
          preview reads as the actual product, not a stand-in dashboard. */}
      <div className="hidden w-14 shrink-0 flex-col items-center gap-3 bg-shell py-4 sm:flex">
        <span className="text-sm font-bold text-white">ر</span>
        <span className="h-8 w-8 rounded-md bg-shell-active" />
        {[Users, Layers, CalendarRange, Wallet].map((Icon, i) => (
          <Icon key={i} className="h-4 w-4 text-shell-text-muted" aria-hidden />
        ))}
      </div>

      <div className="flex-1">
        <div className="flex items-center border-b border-border bg-surface-sunken px-4 py-3">
          <span className="text-xs font-medium text-text-secondary">الرئيسية</span>
        </div>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between rounded-md border border-border bg-brand-subtle px-3 py-2 text-sm">
            <span className="text-brand-subtle-foreground">الحصة القادمة: مجموعة الرياضيات</span>
            <span className="rounded-md bg-brand px-2 py-1 text-xs font-medium text-brand-foreground">فتح الحصة</span>
          </div>
          <p className="text-xs font-semibold text-text-secondary">يحتاج إجراء الآن</p>
          {[
            { label: "3 طلاب لم يُسجَّل حضورهم في حصة الأمس", tone: "warning" as const },
            { label: "دفعة متأخرة من ولي أمر — تذكير مطلوب", tone: "danger" as const },
            { label: "متابعة مستحقة لحالة انتباه مفتوحة", tone: "neutral" as const },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span className="text-text-primary">{row.label}</span>
              <Badge tone={row.tone}>{row.tone === "warning" ? "متوسط" : row.tone === "danger" ? "عاجل" : "سياقي"}</Badge>
            </div>
          ))}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <MiniStat icon={Users} label="الطلاب" />
            <MiniStat icon={Wallet} label="المالية" />
            <MiniStat icon={FileBarChart} label="التقارير" />
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

function MiniStat({ icon: Icon, label }: { icon: typeof Users; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border border-border py-3 text-xs text-text-secondary">
      <Icon className="h-4 w-4 text-brand" aria-hidden />
      {label}
    </div>
  );
}

/** SoftwareApplication + Organization + FAQPage JSON-LD — safe to render on the server, no PII. */
function StructuredData() {
  const softwareApplication = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "راصد",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: "نظام تشغيل ومتابعة للمدرسين وأصحاب المجموعات التعليمية — حضور، واجبات، متابعة، ومالية في مكان واحد.",
    offers: {
      "@type": "Offer",
      priceCurrency: "EGP",
      description: "تجربة مجانية 14 يومًا بدون بطاقة ائتمان.",
    },
  };
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "راصد",
    url: "https://rasid-web.vercel.app",
  };
  const faqPage = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplication) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPage) }} />
    </>
  );
}
