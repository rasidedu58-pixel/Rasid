import type { ReactNode } from "react";
import { MarketingHeader } from "../../components/marketing/marketing-header";
import { MarketingFooter } from "../../components/marketing/marketing-footer";
import { WhatsappFab } from "../../components/marketing/whatsapp-fab";

/**
 * Public marketing shell — landing/pricing/faq/legal/support. Fully
 * server-rendered except the header's mobile-menu toggle. The floating
 * WhatsApp action lives here so it's present on every marketing page but
 * absent inside the authenticated app shell.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
      <WhatsappFab />
    </div>
  );
}
