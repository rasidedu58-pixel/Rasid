import { ClipboardCheck, Wallet } from "lucide-react";
import { TiltCard } from "./anim";

/**
 * Hero product preview — a REAL, high-resolution screenshot captured from inside
 * Rasid's own Dashboard (the "مركز الإجراءات" daily command center), shown in a
 * premium frame: a soft brand glow, two floating status chips, and a subtly
 * tilting card. This replaced the earlier hand-coded mock so the landing hero
 * shows the actual product a teacher uses every day — real RTL layout, real
 * features (next session, needs-attention queue, collection), natural demo names.
 *
 * The image is a static asset (`/public/hero-dashboard.png`, 2880×1800) served
 * with its intrinsic aspect ratio locked via width/height (no layout shift) and
 * scaled fluidly to the column. Loaded eagerly — it is above the fold (LCP).
 */
export function HeroProductPreview() {
  return (
    <div className="relative mx-auto max-w-md lg:max-w-none">
      <div aria-hidden className="pointer-events-none absolute -inset-6 -z-10 bg-[radial-gradient(60%_60%_at_50%_30%,hsl(var(--brand)/0.18),transparent_70%)]" />

      {/* Floating status chips — echo two real signals visible in the shot. */}
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
        <div className="overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-floating">
          {/* Deliberate plain <img>: next/image is unused project-wide and there is no
              images config; a static 192 KB asset needs no runtime optimization, and a
              plain tag avoids an untested build path. */}
          <img
            src="/hero-dashboard.png"
            alt="لوحة تحكم راصد — مركز الإجراءات اليومي للمعلّم: الحصة القادمة، الحالات التي تحتاج إجراءً، والتحصيل المتأخر"
            width={2880}
            height={1800}
            loading="eager"
            decoding="async"
            className="block h-auto w-full"
          />
        </div>
      </TiltCard>
    </div>
  );
}
