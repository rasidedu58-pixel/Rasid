# Release Gates — Pre-Production

This document tracks every known reason Rasid is **not yet cleared for a
real commercial launch**, even though Phase 11 (Teacher V1) and Phase 12
(public site + Platform Admin) are both closed. It is updated honestly as
gates close — never by declaring one closed without real evidence.

The project remains in a **pre-launch/staging posture**. `NODE_ENV` stays
out of `production` until every gate below is explicitly closed and a
human makes the actual launch decision.

## Open gates

### 1. Backup/restore drill (carried from Phase 10)
Never actually exercised end-to-end (a real backup taken, a real restore
performed, data verified afterward) against this project's Supabase
instance. Status: **pending** — requires a human to run and document the
drill, not a code change.

### 2. Supabase connection budget / headroom (carried from Phase 10)
The shared Supabase project's Session Pooler caps this tier at 15
simultaneous connections; `app_runtime` (max 10) + `app_worker` (max 5)
already consumes the entire budget with zero headroom for a second API
instance, a migration connection, or (as of Phase 12) the new
`app_platform_admin` connection (max 5, see
`packages/database/src/migrations/0048_platform_admin.sql`) running
concurrently. Status: **pending** — requires either a higher-tier
Supabase plan or a real load-test-informed pool re-budget before
horizontal scaling or heavy concurrent platform-admin use.

### 3. Paddle real (sandbox/live) validation (carried from Phase 8/10)
`PaddleBillingProvider` (`apps/api/src/billing/infrastructure/paddle-billing.provider.ts`)
has never been exercised against a real Paddle sandbox or production
account in this environment — only against `FakeBillingProvider` in
tests. Status: **pending** — requires a human with real Paddle
credentials to run an actual checkout → webhook → entitlement cycle.

### 4. Commercial multi-tier billing gap (new, Phase 12)
The public `/pricing` page presents 6 capacity-based packages (99–699
EGP/month, plus a custom tier), per explicit product decision — but the
real backend billing model (Phase 8) supports exactly **one** Paddle
price (`PADDLE_PRICE_ID`) and one subscription per workspace. Every
package's "ابدأ تجربتك المجانية" button starts the same real trial;
**no package selection is actually wired to a distinct Paddle price**.
Closing this gate requires extending the billing domain (a `plan`/`tier`
concept on `subscriptions`, multiple Paddle price ids, checkout-time plan
selection) — deliberately NOT done in Phase 12 (explicit scope
instruction: no Domain change without a real blocker). Status: **open,
by design** — must close before a customer can actually pay for a
specific tier.

### 5. Support contact channel
`/support`'s `support@rasid.app` address is a placeholder — no real,
monitored inbox exists yet anywhere in this project's configuration
(verified by search before Phase 12; see the page's own code comment).
Status: **pending** — replace with a real address before launch.

### 6. Legal text review
`/privacy` and `/terms` are product-ready drafts describing only real,
verified system behavior — **not reviewed by a lawyer**. Status:
**pending** — required before commercial launch (both pages carry this
same disclaimer visibly).

### 7. Platform Admin — read-only in V1
Workspace suspension (Part F.9 of the Phase 12 brief) was evaluated and
deliberately **not built** — it would require both a new mutation
endpoint (state + reason + actor + audit, straightforward) AND real
enforcement in the Teacher app's own authorization path (`PermissionGuard`
checking a suspended flag), which is a larger cross-cutting change than
this phase's "smallest complete" scope allows safely. Status: **deferred,
not a bug** — `platform_audit_events` (the audit trail table) already
exists and is ready for the first real mutation once built.

### 8. Product screenshots
The landing page's product preview panel is built from the real design
system's own tokens/components/copy, not a generic stock illustration —
but it is a faithful recreation, not an actual captured screenshot (no
authenticated test account was available in the building session).
Status: **pending** — replace with real screenshots once available.

### 9. Google Search Console
Not performed — requires access to the Google account that will own the
Rasid property, which was not available. The site is technically ready
(sitemap.xml, robots.txt, structured data, per-page metadata) for manual
verification + sitemap submission + indexing request once that access
exists. Status: **pending, human action only**.

## Closed gates

*(none yet — this list grows as gates above are genuinely closed with evidence)*
