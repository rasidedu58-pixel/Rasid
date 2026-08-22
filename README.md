# Academic Precision — Teacher V1

A production-oriented, Arabic-first/RTL SaaS monorepo. This repository currently
implements **Phase 0 — Repository & Foundation only**. No business feature
(Students, Groups, Sessions, Finance, Attention, Subscriptions, Auth flows,
Reports, etc.) is implemented yet.

For the full governing package and engineering rules, read, in order:

1. `00_READ_FIRST.md`
2. `docs/01_PRD_V1.1_FINAL.md`
3. `docs/02_TECHNICAL_ARCHITECTURE_V1.0_APPROVED.md`
4. `docs/03_DATABASE_SCHEMA_V1.0_APPROVED.md`
5. `docs/04_API_CONTRACT_V1.0_APPROVED.md`
6. `docs/05_IMPLEMENTATION_PLAN_AND_HANDOFF_V1.0_APPROVED.md`
7. `06_MASTER_CLAUDE_CODE_PROMPT.md`
8. `07_PHASE_0_PROMPT.md` (and later, the prompt for whichever phase is currently authorized)

## Repository shape

```text
apps/
  web/       Next.js App Router shell (Arabic-first/RTL)
  api/       NestJS + Fastify API shell (/api/v1, health/readiness only)
  worker/    Standalone TypeScript worker process (no jobs registered yet)
packages/
  ui/            Package boundary placeholder for the future design system
  contracts/     Shared API error + cursor pagination primitives
  database/      Drizzle foundation (structural schema placeholders only)
  config/        Typed env/config helpers (browser-safe vs server-only)
  observability/ Structured logging, correlation context, Sentry/OTel stubs
  shared/        Cross-cutting primitives (Result type, MoneyMinor type)
infrastructure/  Reserved for deployment/infra-as-code (later phase)
tooling/         Reserved for internal dev tooling (later phase)
docs/            Governing product/architecture/API/DB documents
```

## Prerequisites

- Node.js >= 20 (developed against Node 24)
- pnpm 9.15.0 (`npm install -g pnpm`, or via corepack)

No external accounts/credentials (Supabase, Redis, Resend, R2, Paddle, Sentry,
PostHog) are required to install dependencies or run `lint`/`typecheck`/`test`/
`build`. Every environment variable is optional at the schema level; only code
that actually connects to a live service asserts its own requirement, and
nothing in Phase 0 connects to a live service during these commands.

## Local setup

```bash
pnpm install
cp .env.example .env   # optional for Phase 0 — fill in only what you need locally
```

## Running apps in development

```bash
pnpm --filter @academic-precision/web dev      # http://localhost:3000
pnpm --filter @academic-precision/api dev      # http://localhost:3000/api/v1/health
pnpm --filter @academic-precision/worker dev   # long-running process, logs to stdout
```

`apps/api` and `apps/web` both default to port 3000 — run them with a different
`PORT` (api) or Next's `-p` flag if running side by side locally.

## Workspace-wide commands

Run from the repository root; each fans out via Turborepo to every app/package
that defines the corresponding script:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Database (packages/database)

- Drizzle is configured against `packages/database/src/schema` (currently
  structural placeholders only — no domain schema in Phase 0).
- `pnpm --filter @academic-precision/database db:generate` — generates SQL
  migrations from the schema.
- `pnpm --filter @academic-precision/database db:migrate` — applies pending
  migrations against `DATABASE_URL`. **Migrations are the only production
  schema-change path** — nothing auto-pushes/syncs schema to a live database.

## Environment strategy

- `.env.example` (repo root) lists every variable name + a one-line
  description. Never commit real values.
- `development` — local `.env`/`.env.local` files, never committed.
- `staging` / `production` — variables are configured in the hosting
  provider (Vercel for `apps/web`; Render for `apps/api`/`apps/worker`), not
  committed to the repository.
- `apps/web` only ever reads `NEXT_PUBLIC_*` (browser-safe) values on the
  client; server-only secrets stay in `packages/config`'s server module and
  `apps/api`/`apps/worker`.

## Current phase status

**Phase 0 only.** This repository is infrastructure/foundation: monorepo
tooling, app/package skeletons, health endpoints, structural DB schema
boundaries, CI baseline. No later-phase business features (Auth flows,
Workspace onboarding, Groups/Sessions/Students/Finance/Attention/
Subscriptions/Notifications/Reports/Center product) are implemented. Do not
begin later-phase work without an explicit new phase authorization — see
`00_READ_FIRST.md` section 6.
