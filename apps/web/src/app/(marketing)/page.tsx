import type { Metadata } from "next";
import type { ReactNode } from "react";
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
  DatabaseBackup,
  Activity,
  Smartphone,
  ArrowLeft,
  Check,
  X,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Badge, Button, Card, CardContent } from "@academic-precision/ui";
import { AuthenticatedRedirect } from "../../components/marketing/authenticated-redirect";
import { PricingTable } from "../../components/marketing/pricing-table";
import { PricingCalculator } from "../../components/marketing/pricing-calculator";
import { SplashScreen } from "../../components/marketing/splash-screen";
import { MotionRoot, Reveal } from "../../components/marketing/motion";
import { TiltCard } from "../../components/marketing/anim";
import { FaqSearch } from "../../components/marketing/faq-search";
import { TestimonialsSection, LogosSection, StatsSection } from "../../components/marketing/social-proof";
import { FAQ_ITEMS } from "../../lib/marketing/faq-config";
import { TRIAL_DAYS } from "../../lib/marketing/pricing-config";

export const metadata: Metadata = {
  title: "راصد — نظام تشغيل ومتابعة للمدرسين وأصحاب المجموعات التعليمية",
  description:
    "شغّل مجموعاتك التعليمية دون أن يضيع منك شيء: الحضور والواجبات والتحصيل والمتابعة في مكان واحد، وراصد يُظهر لك ما يحتاج تدخّلك الآن. جرّبه مجانًا 14 يومًا بدون بطاقة.",
  alternates: { canonical: "/" },
};

/* ── Content models (real, shipped capabilities; only presentation changed) ── */

const HOW_IT_WORKS = [
  {
    step: "١",
    title: "سجّل ما يحدث في الحصة",
    description: "الحضور والواجب والدرجة من هاتفك أثناء الحصة نفسها — بلا دفاتر ولا رسائل متفرقة.",
  },
  {
    step: "٢",
    title: "راصد يرتّب الصورة",
    description: "يجمع تسجيلاتك ويُبرز ما يحتاج انتباهك — بسببه ودليله — دون أن تبحث عنه بنفسك.",
  },
  {
    step: "٣",
    title: "تصرّف وتابع… حتى تُغلق الحالة",
    description: "ذكّر بدفعة، تابِع حالة، أكمِل سجلًا ناقصًا — راصد يبقيها أمامك حتى تنتهي منها فعلًا.",
  },
];

const FEATURE_GROUPS = [
  {
    title: "التشغيل اليومي",
    tone: "brand" as const,
    icon: CalendarClock,
    wide: true,
    items: [
      { icon: CalendarClock, label: "حصص تُجدوَل عنك", description: "جدول حصصك يتولّد من مواعيدك الأسبوعية — بلا إدخال يدوي متكرر." },
      { icon: ClipboardCheck, label: "حضور في لحظته", description: "سجّله من هاتفك أثناء الحصة، واعرف من غاب فورًا." },
      { icon: NotebookPen, label: "لا واجب يمرّ دون رصد", description: "من أنجز، ومن لم يُسجَّل له شيء بعد — أمامك." },
    ],
  },
  {
    title: "الطالب وتاريخه",
    tone: "neutral" as const,
    icon: Users,
    wide: false,
    items: [
      { icon: Users, label: "ملف يتبع الطالب", description: "بياناته وأولياء أموره وسجله في مكان واحد، ولو انتقل بين مجموعاتك." },
      { icon: Layers, label: "مجموعات تحفظ التاريخ", description: "كل مجموعة بجدولها ورسومها — دون أن يضيع سجل طالب." },
      { icon: GraduationCap, label: "درجات مربوطة بكل طالب", description: "ارصد النتيجة فتظهر في ملفه مباشرة." },
    ],
  },
  {
    title: "ما يحتاج تدخّلك",
    tone: "brand" as const,
    icon: Sparkles,
    wide: false,
    items: [
      { icon: Sparkles, label: "قرارك التالي في شاشة", description: "ما يستحق تدخّلك الآن مجموعًا أمامك — دون أن تبحث عنه." },
      { icon: Bell, label: "لا تكتشف المشكلة متأخرًا", description: "تنبيه بما يحتاج متابعة قبل أن يفوتك." },
      { icon: FileBarChart, label: "افهم دون أن تجمّع", description: "تقارير جاهزة لكل طالب ومجموعة وشهر، بلا حساب يدوي." },
    ],
  },
  {
    title: "المالية بوضوح",
    tone: "neutral" as const,
    icon: Wallet,
    wide: true,
    items: [
      { icon: Wallet, label: "اعرف ما على كل طالب", description: "مستحقات هذا الشهر أمامك، دون ورقة رسوم منفصلة." },
      { icon: HeartHandshake, label: "دفعة تُسجَّل وتبقى", description: "مرتبطة بسجلها، والتصحيح يُوثَّق دون أن يمحو التاريخ." },
      { icon: CalendarRange, label: "من تأخّر… ومنذ متى", description: "المتأخرات واضحة، دون بحث في الأوراق." },
    ],
  },
];

const BEFORE = [
  "دفتر حضور ورقي لكل مجموعة",
  "رسائل واتساب متفرقة مع أولياء الأمور",
  "تحصيل يدوي وورقة رسوم منفصلة",
  "متابعة تعتمد على ذاكرتك وحدها",
  "تقارير تجمعها يدويًا آخر الشهر",
];

const AFTER = [
  "تشغيلك كله في مكان واحد تفتحه من الهاتف",
  "ما يحتاج تدخّلك يأتيك — بسببه ودليله",
  "الحضور والواجب والدرجة تُسجَّل أثناء الحصة",
  "تعرف من دفع ومن تأخّر دون أن تبحث",
  "صورة كل طالب وشهر جاهزة وقتما احتجتها",
];

const PERSONAS = [
  {
    icon: UserRound,
    title: "تدير مجموعاتك بنفسك؟",
    pain: "كل غياب ودفعة وواجب يعتمد على ذاكرتك وحدها — وشيء ما يضيع دائمًا.",
    help: "راصد يجمع التسجيل والتحصيل والمتابعة في مكان واحد، ويذكّرك بما تبقّى.",
  },
  {
    icon: Layers,
    title: "كبرت مجموعاتك وبدأت التفاصيل تضيع؟",
    pain: "عشرات الطلاب عبر مجموعات مختلفة، وأي تفصيل يسهل أن يسقط بينها.",
    help: "كل مجموعة بجدولها ورسومها وطلابها، وشاشة واحدة تجمع ما يحتاج قرارك.",
  },
  {
    icon: UsersRound,
    title: "تعمل مع مساعد أو فريق صغير؟",
    pain: "تحتاج من يساعدك في التسجيل، دون أن تفتح كل شيء للجميع.",
    help: "صلاحيات دقيقة تحدد من يرى ومن يعدّل ماذا — مجموعة بمجموعة.",
  },
];

const TRUST_POINTS = [
  { icon: KeyRound, title: "فصل كامل بين مساحات العمل", description: "بيانات كل مدرس معزولة تمامًا عن غيره على مستوى قاعدة البيانات." },
  { icon: ShieldCheck, title: "صلاحيات دقيقة لكل عضو فريق", description: "تحدد أنت من يرى ماذا ومن يستطيع تعديل ماذا، مجموعة بمجموعة." },
  { icon: History, title: "سجل كامل للعمليات المالية", description: "كل دفعة ومستحق محفوظ ومرتبط بسجله، دون تعديل يمحو التاريخ." },
  { icon: DatabaseBackup, title: "نسخ احتياطي دوري لبياناتك", description: "بياناتك تُنسخ احتياطيًا بشكل منتظم وخارج الخادم، ويُختبر استرجاعها." },
  { icon: Activity, title: "مراقبة استقرار مستمرة", description: "نراقب استقرار النظام باستمرار لنعالج أي خلل قبل أن يؤثر على عملك." },
];

/**
 * Landing page (`/`) — Design System v2 (dark-first). Real content is
 * server-rendered for SEO; small client islands add motion (`SplashScreen`,
 * `MotionRoot`/`Reveal`, `TiltCard`, `FaqSearch`, social-proof shells). Every
 * capability shown is a real, shipped Teacher V1 feature. Social-proof sections
 * render nothing until real testimonials/logos/metrics are supplied.
 */
export default function LandingPage() {
  return (
    <>
      <SplashScreen />
      <MotionRoot />
      <AuthenticatedRedirect />
      <StructuredData />

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="hero-drift hero-mesh absolute inset-0" />
          <div className="hero-grid absolute inset-0" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-16 sm:px-6 sm:pt-24 lg:pt-28">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
            <div className="flex flex-col items-start gap-6">
              <Reveal as="div" className="w-fit">
                <Badge tone="brand" className="border border-brand/20 px-3 py-1">
                  نظام تشغيل مجموعاتك — لا مجرّد تسجيل بيانات
                </Badge>
              </Reveal>
              <Reveal as="h1" delay={60} className="text-display text-text-primary">
                شغّل مجموعاتك
                <br />
                <span className="text-gradient">دون أن يضيع منك شيء</span>
              </Reveal>
              <Reveal as="p" delay={120} className="max-w-xl text-lg leading-relaxed text-text-secondary sm:text-[1.125rem]">
                الحصص والحضور والواجبات والتحصيل والمتابعة في مكان واحد — وراصد يُظهر لك ما يحتاج تدخّلك الآن، قبل أن يفوتك.
              </Reveal>
              <Reveal as="div" delay={180}>
                <OperatingRhythm />
              </Reveal>
              <Reveal as="div" delay={240} className="flex flex-col gap-3 pt-1 sm:flex-row">
                <Button asChild size="lg">
                  <Link href="/signup">ابدأ {TRIAL_DAYS} يومًا مجانًا</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="#how-it-works">شاهد راصد أثناء العمل</Link>
                </Button>
              </Reveal>
              <Reveal as="p" delay={300} className="text-sm text-text-tertiary">
                {TRIAL_DAYS} يومًا مجانًا • بدون بطاقة ائتمان.
              </Reveal>
            </div>

            <Reveal as="div" delay={160} className="relative">
              <HeroProductPreview />
            </Reveal>
          </div>
        </div>
      </section>

      {/* Partner logos — renders only when real logos are supplied. */}
      <LogosSection />

      {/* ── Before / After ── */}
      <section className="border-t border-border bg-surface-sunken py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <Reveal as="div" className="mb-12 text-center">
            <h2 className="text-h2 text-text-primary">المشكلة ليست في البيانات… بل في أن المهم يضيع وسطها</h2>
            <p className="mx-auto mt-3 max-w-2xl text-text-secondary">
              ليس لأنك مقصّر — بل لأن كل شيء في مكان مختلف. راصد يجمعها، ويُبرز ما يحتاج قرارك دون أن تبحث عنه.
            </p>
          </Reveal>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Reveal as="div">
              <ComparisonCard variant="before" title="قبل راصد" items={BEFORE} />
            </Reveal>
            <Reveal as="div" delay={100}>
              <ComparisonCard variant="after" title="مع راصد" items={AFTER} />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── How it works — 3 steps on a connecting path ── */}
      <section id="how-it-works" className="mx-auto max-w-5xl px-4 py-20 sm:px-6">
        <Reveal as="div" className="mb-14 text-center">
          <SectionEyebrow>كيف يعمل</SectionEyebrow>
          <h2 className="mt-3 text-h2 text-text-primary">من الحصة إلى القرار… في ثلاث خطوات</h2>
        </Reveal>
        <div className="relative grid grid-cols-1 gap-6 md:grid-cols-3">
          <div aria-hidden className="absolute inset-x-[16%] top-9 hidden h-px bg-gradient-to-l from-transparent via-border-strong to-transparent md:block" />
          {HOW_IT_WORKS.map((item, i) => (
            <Reveal as="div" key={item.step} delay={i * 90} className="relative">
              <StepCard step={item.step} title={item.title} description={item.description} />
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Features — asymmetric bento ── */}
      <section id="features" className="border-t border-border bg-surface-sunken py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal as="div" className="mb-12 text-center">
            <SectionEyebrow>المزايا</SectionEyebrow>
            <h2 className="mt-3 text-h2 text-text-primary">ليست مجرد أدوات تسجيل — كل شيء يخدم قرارك التالي</h2>
          </Reveal>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {FEATURE_GROUPS.map((group, i) => (
              <Reveal
                as="div"
                key={group.title}
                delay={(i % 2) * 90}
                className={group.wide ? "lg:col-span-2" : "lg:col-span-1"}
              >
                <FeatureGroupCard group={group} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Data-driven stats — renders only when real metrics are supplied. */}
      <StatsSection />

      {/* ── Audience personas ── */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <Reveal as="div" className="mb-12 text-center">
          <SectionEyebrow>لمن هو راصد</SectionEyebrow>
          <h2 className="mt-3 text-h2 text-text-primary">أيًّا كان حجم مجموعاتك… ستجد نفسك هنا</h2>
        </Reveal>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {PERSONAS.map((persona, i) => (
            <Reveal as="div" key={persona.title} delay={i * 90}>
              <PersonaCard persona={persona} />
            </Reveal>
          ))}
        </div>
        <Reveal as="p" delay={120} className="mt-10 flex items-center justify-center gap-2 text-sm text-text-tertiary">
          <Smartphone className="h-4 w-4" aria-hidden />
          نسخة المراكز التعليمية بفروع ومشرفين قادمة لاحقًا.
        </Reveal>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="border-t border-border bg-surface-sunken py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal as="div" className="mb-10 text-center">
            <SectionEyebrow>الأسعار</SectionEyebrow>
            <h2 className="mt-3 text-h2 text-text-primary">ادفع حسب عدد طلابك — لا أكثر</h2>
            <p className="mt-3 text-text-secondary">
              كل الباقات تشمل مزايا راصد كاملة؛ الفرق الوحيد هو سعة الطلاب. جرّب {TRIAL_DAYS} يومًا مجانًا — بدون بطاقة، وألغِ وقت ما تشاء.
            </p>
          </Reveal>

          <Reveal as="div" className="mb-12">
            <PricingCalculator />
          </Reveal>

          <Reveal as="div">
            <PricingTable />
          </Reveal>
          <div className="mt-10 text-center">
            <Link href="/pricing" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
              كل تفاصيل الباقات
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {/* Testimonials — renders only when real testimonials are supplied. */}
      <TestimonialsSection />

      {/* ── Security / trust ── */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <Reveal as="div" className="mb-12 text-center">
          <SectionEyebrow>الأمان والموثوقية</SectionEyebrow>
          <h2 className="mt-3 text-h2 text-text-primary">بيانات مجموعاتك ليست شيئًا نتركه للصدفة</h2>
        </Reveal>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TRUST_POINTS.map((point, i) => (
            <Reveal as="div" key={point.title} delay={(i % 3) * 80}>
              <TrustCard icon={point.icon} title={point.title} description={point.description} />
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── FAQ (searchable) ── */}
      <section className="border-t border-border bg-surface-sunken py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <Reveal as="div" className="mb-10 text-center">
            <SectionEyebrow>الأسئلة الشائعة</SectionEyebrow>
            <h2 className="mt-3 text-h2 text-text-primary">قبل أن تبدأ… إليك ما يشغل بالك</h2>
          </Reveal>
          <Reveal as="div">
            <FaqSearch items={FAQ_ITEMS} />
          </Reveal>
          <div className="mt-8 text-center">
            <Link href="/faq" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
              كل الأسئلة الشائعة
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative overflow-hidden py-24">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="rasid-cta-glow absolute inset-0" />
          <div className="hero-grid absolute inset-0 opacity-60" />
        </div>
        <Reveal as="div" className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-h1 text-text-primary">دع راصد يمسك التفاصيل… وركّز أنت في طلابك</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-text-secondary">
            ابدأ اليوم، ونظّم مجموعاتك من الحصة القادمة — وستعرف ما يحتاج تدخّلك قبل أن تنساه.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/signup">ابدأ {TRIAL_DAYS} يومًا مجانًا</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/login">تسجيل الدخول</Link>
            </Button>
          </div>
          <p className="mt-5 text-sm text-text-tertiary">{TRIAL_DAYS} يومًا مجانًا • بدون بطاقة ائتمان.</p>
        </Reveal>
      </section>
    </>
  );
}

/* ─────────────────────────── Presentational parts ─────────────────────────── */

function SectionEyebrow({ children }: { children: ReactNode }) {
  return <p className="text-sm font-semibold tracking-wide text-brand">{children}</p>;
}

/** The سجّل → افهم → تصرّف → تابع rhythm as a compact right-to-left flow. */
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

function ComparisonCard({ variant, title, items }: { variant: "before" | "after"; title: string; items: string[] }) {
  const isAfter = variant === "after";
  return (
    <div
      className={`h-full rounded-2xl border p-6 transition-shadow sm:p-7 ${
        isAfter ? "border-brand/30 bg-surface shadow-sm ring-1 ring-brand/10" : "border-border bg-surface/60"
      }`}
    >
      <div className="mb-5 flex items-center gap-2.5">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            isAfter ? "bg-gradient-cta text-brand-foreground" : "bg-surface-sunken text-text-tertiary"
          }`}
        >
          {isAfter ? <Check className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
        </span>
        <h3 className={`text-lg font-semibold ${isAfter ? "text-text-primary" : "text-text-secondary"}`}>{title}</h3>
      </div>
      <ul className="flex flex-col gap-3.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-sm">
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${isAfter ? "text-brand" : "text-text-tertiary"}`}>
              {isAfter ? <Check className="h-4 w-4" aria-hidden /> : <X className="h-[13px] w-[13px]" aria-hidden />}
            </span>
            <span className={isAfter ? "text-text-primary" : "text-text-secondary"}>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepCard({ step, title, description }: { step: string; title: string; description: string }) {
  return (
    <div className="card-glow group relative h-full rounded-2xl border border-border bg-surface p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-card-hover">
      <span className="relative flex h-[68px] w-[68px] items-center justify-center rounded-2xl bg-brand-subtle text-2xl font-bold text-brand-subtle-foreground ring-4 ring-surface">
        {step}
      </span>
      <p className="mt-5 text-lg font-semibold text-text-primary">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">{description}</p>
    </div>
  );
}

type FeatureGroup = (typeof FEATURE_GROUPS)[number];

function FeatureGroupCard({ group }: { group: FeatureGroup }) {
  const GroupIcon = group.icon;
  return (
    <div className="card-glow group h-full rounded-2xl border border-border bg-surface p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-card-hover sm:p-7">
      <div className="mb-5 flex items-center gap-3">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            group.tone === "brand" ? "bg-gradient-cta text-brand-foreground" : "bg-brand-subtle text-brand-subtle-foreground"
          }`}
        >
          <GroupIcon className="h-5 w-5" aria-hidden />
        </span>
        <h3 className="text-lg font-semibold text-text-primary">{group.title}</h3>
      </div>
      <ul className={group.wide ? "grid gap-4 sm:grid-cols-3" : "flex flex-col divide-y divide-border"}>
        {group.items.map((item) => (
          <li key={item.label} className={group.wide ? "" : "flex items-start gap-3 py-3 first:pt-0 last:pb-0"}>
            {group.wide ? (
              <>
                <item.icon className="mb-2 h-[18px] w-[18px] text-brand" aria-hidden />
                <p className="text-sm font-medium text-text-primary">{item.label}</p>
                <p className="mt-0.5 text-sm text-text-secondary">{item.description}</p>
              </>
            ) : (
              <>
                <item.icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-brand" aria-hidden />
                <div>
                  <p className="text-sm font-medium text-text-primary">{item.label}</p>
                  <p className="mt-0.5 text-sm text-text-secondary">{item.description}</p>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

type Persona = (typeof PERSONAS)[number];

function PersonaCard({ persona }: { persona: Persona }) {
  const Icon = persona.icon;
  return (
    <div className="card-glow flex h-full flex-col rounded-2xl border border-border bg-surface p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-card-hover">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-subtle text-brand-subtle-foreground">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="mt-4 text-lg font-semibold text-text-primary">{persona.title}</p>
      <p className="mt-3 text-sm leading-relaxed text-text-secondary">{persona.pain}</p>
      <div className="mt-4 flex items-start gap-2 border-t border-border pt-4 text-sm text-text-primary">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
        <span>{persona.help}</span>
      </div>
    </div>
  );
}

function TrustCard({ icon: Icon, title, description }: { icon: typeof KeyRound; title: string; description: string }) {
  return (
    <div className="card-glow h-full rounded-2xl border border-border bg-surface p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-card-hover">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-subtle text-brand-subtle-foreground">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="mt-4 font-semibold text-text-primary">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">{description}</p>
    </div>
  );
}

/**
 * Honest product mockup — built from the SAME design tokens/labels the real
 * Dashboard uses (real feature names, real "مركز الإجراءات" framing), inside a
 * premium frame with a soft glow and two slow-floating status chips, with a
 * subtle pointer 3D tilt. Not a stock illustration or invented metrics.
 */
function HeroProductPreview() {
  return (
    <div className="relative mx-auto max-w-md lg:max-w-none">
      {/* ambient glow behind the frame */}
      <div aria-hidden className="pointer-events-none absolute -inset-6 -z-10 bg-[radial-gradient(60%_60%_at_50%_30%,hsl(var(--brand)/0.18),transparent_70%)]" />

      {/* floating chips */}
      <div className="rasid-float pointer-events-none absolute -start-4 top-14 z-10 hidden rounded-xl border border-border bg-surface px-3 py-2 shadow-floating sm:block" style={{ animationDelay: "0.4s" }}>
        <p className="flex items-center gap-2 text-xs font-medium text-text-primary">
          <ClipboardCheck className="h-4 w-4 text-brand" aria-hidden />
          حضور حصة اليوم سُجّل
        </p>
      </div>
      <div className="rasid-float pointer-events-none absolute -end-3 bottom-16 z-10 hidden rounded-xl border border-border bg-surface px-3 py-2 shadow-floating sm:block" style={{ animationDelay: "1.4s" }}>
        <p className="flex items-center gap-2 text-xs font-medium text-text-primary">
          <Wallet className="h-4 w-4 text-danger" aria-hidden />
          دفعة متأخرة — تذكير
        </p>
      </div>

      <TiltCard>
        <Card className="overflow-hidden rounded-2xl border-border/80 shadow-floating">
          <div className="flex">
            <div className="hidden w-14 shrink-0 flex-col items-center gap-3 bg-shell py-4 sm:flex">
              <span className="text-sm font-bold text-white">ر</span>
              <span className="h-8 w-8 rounded-md bg-shell-active" />
              {[Users, Layers, CalendarRange, Wallet].map((Icon, i) => (
                <Icon key={i} className="h-4 w-4 text-shell-text-muted" aria-hidden />
              ))}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between border-b border-border bg-surface-sunken px-4 py-3">
                <span className="text-xs font-medium text-text-secondary">الرئيسية</span>
                <span className="flex items-center gap-1 text-[11px] text-text-tertiary">
                  <Sparkles className="h-3 w-3 text-brand" aria-hidden />
                  مركز الإجراءات
                </span>
              </div>
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between rounded-lg border border-brand/25 bg-brand-subtle px-3 py-2.5 text-sm">
                  <span className="text-brand-subtle-foreground">الحصة القادمة: مجموعة الرياضيات</span>
                  <span className="rounded-md bg-gradient-cta px-2 py-1 text-xs font-medium text-brand-foreground">فتح الحصة</span>
                </div>
                <p className="pt-1 text-xs font-semibold text-text-secondary">يحتاج إجراء الآن</p>
                {[
                  { label: "٣ طلاب لم يُسجَّل حضورهم أمس", tone: "warning" as const, badge: "متوسط" },
                  { label: "دفعة متأخرة من ولي أمر — تذكير مطلوب", tone: "danger" as const, badge: "عاجل" },
                  { label: "متابعة مستحقة لحالة انتباه مفتوحة", tone: "neutral" as const, badge: "سياقي" },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-sm">
                    <span className="text-text-primary">{row.label}</span>
                    <Badge tone={row.tone}>{row.badge}</Badge>
                  </div>
                ))}
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <MiniStat icon={Users} label="الطلاب" />
                  <MiniStat icon={Wallet} label="المالية" />
                  <MiniStat icon={FileBarChart} label="التقارير" />
                </div>
              </CardContent>
            </div>
          </div>
        </Card>
      </TiltCard>
    </div>
  );
}

function MiniStat({ icon: Icon, label }: { icon: typeof Users; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-border py-3 text-xs text-text-secondary">
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
