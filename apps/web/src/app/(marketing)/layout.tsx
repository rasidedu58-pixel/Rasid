import type { ReactNode } from "react";
import { MarketingHeader } from "../../components/marketing/marketing-header";
import { MarketingFooter } from "../../components/marketing/marketing-footer";

/** Public marketing shell — landing/pricing/faq/legal/support. Fully server-rendered except the header's mobile-menu toggle. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-scope flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
