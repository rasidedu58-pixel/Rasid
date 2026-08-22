# Academic Precision — Teacher V1
## Phase 0 Prompt — Repository & Foundation

**Authorization:** Implement Phase 0 only.  
**Stop condition:** Once Phase 0 Definition of Done is satisfied, produce the Completion Report and stop. Do not begin Auth, Workspace onboarding or any business feature.

---

## 1. Mandatory preparation

Before writing code:

1. Read `00_READ_FIRST.md`.
2. Read `06_MASTER_CLAUDE_CODE_PROMPT.md`.
3. Read all five files under `docs/` in the required order.
4. Inspect the current repository. If it is empty, initialize it. If it already contains code, preserve useful work only when it is compatible with the approved architecture; do not overwrite blindly.
5. Report a short Phase 0 plan before applying changes.

---

## 2. Phase goal

Create a clean, production-oriented monorepo foundation that later phases can build on without architectural rework.

Phase 0 is **infrastructure and repository foundation only**. It must not contain fake implementations of students, groups, finance, sessions, subscriptions, attention or other domain features.

---

## 3. Required repository shape

Create or normalize the project toward:

```text
academic-precision/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
├── packages/
│   ├── ui/
│   ├── contracts/
│   ├── database/
│   ├── config/
│   ├── observability/
│   └── shared/
├── docs/
├── infrastructure/
├── tooling/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

Keep module boundaries explicit. Do not create a generic `utils` dumping ground.

---

## 4. Toolchain

Configure the approved baseline:

- pnpm workspaces
- Turborepo
- TypeScript in strict mode
- Next.js + React for `apps/web`
- NestJS + Fastify for `apps/api`
- a separate TypeScript worker application for `apps/worker`
- Drizzle-ready database package for PostgreSQL
- shared contract package prepared for OpenAPI/Zod-generated or shared DTO schemas
- ESLint
- Prettier
- test runner appropriate to the workspace packages
- GitHub Actions CI baseline

Do not introduce an alternative framework or major package without an explicit architectural reason supported by the approved documents.

---

## 5. `apps/web`

Create the Arabic-first/RTL web shell only.

Required foundation:

- Next.js App Router
- TypeScript strict
- root document/application direction ready for `rtl`
- Arabic locale baseline
- Tailwind/internal design-system integration foundation consistent with the Technical Architecture
- no production product screens beyond a minimal safe shell/status page needed to prove the app builds
- no direct database access
- no Supabase business-table calls
- environment variable schema/validation for public vs server-only values

Do not invent the final visual system if the design references/tokens are not yet in the repository. Provide placeholders at the infrastructure level only, not a new product design.

---

## 6. `apps/api`

Create the NestJS + Fastify application shell.

Required foundation:

- `/api/v1` prefix strategy
- health/readiness endpoints only as infrastructure endpoints
- structured application bootstrap
- configuration module
- request/correlation ID middleware or interceptor foundation
- standard error-mapping foundation compatible with the approved API error contract
- OpenAPI bootstrap foundation, without inventing feature endpoints
- no business modules implemented yet

Keep controllers thin from the beginning.

---

## 7. `apps/worker`

Create a separate worker process foundation.

Required foundation:

- bootstrappable TypeScript application
- Redis/BullMQ configuration abstraction
- queue/worker registration foundation
- graceful shutdown
- logging/correlation/job metadata foundation where relevant
- no fake domain jobs; do not implement session generation, attention evaluation, billing or reports yet

The worker must be deployable independently from the API.

---

## 8. `packages/database`

Prepare the database package but do **not** implement the full approved domain schema in Phase 0 unless the implementation plan explicitly places foundation schema setup here.

Required foundation:

- Drizzle configuration
- PostgreSQL connection abstraction appropriate for server/container use
- migration directory/process
- schema module structure matching the approved Database Schema document
- safe environment validation
- scripts for migration generation/checking appropriate to the approved workflow

Do not auto-push schema to production. Migrations are the only production schema-change path.

---

## 9. `packages/contracts`

Create the foundation for stable API contracts:

- common error schema/types aligned with API Contract v1.0
- request ID/cursor pagination primitives where useful
- no domain DTO invention before its phase
- avoid coupling public DTOs to DB row types

---

## 10. `packages/ui`

Create only the base package architecture needed to support the future approved design system.

It may include infrastructure-level primitives/configuration, but do not build a large speculative component library in Phase 0.

Do not invent product branding or screen layouts if final design references are not provided in the repository yet.

---

## 11. `packages/config`, `packages/observability`, `packages/shared`

Establish clean shared foundations:

### config
- typed environment/config handling
- separation of browser-safe and server-only configuration

### observability
- structured logging interface
- Sentry/OpenTelemetry-ready adapters/interfaces without unnecessary production coupling if credentials are not available
- correlation/request/job context helpers

### shared
- only truly cross-cutting primitives
- no domain/business rules that belong to a module

---

## 12. Environment strategy

Prepare documented environment handling for:

- development
- staging
- production

Never commit real secrets.

Provide `.env.example` files containing names/descriptions only.

Include placeholders/configuration boundaries for the approved providers where relevant to the foundation:

- Supabase
- PostgreSQL
- Redis
- Resend
- Cloudflare R2
- Paddle
- Sentry/PostHog as applicable

Do not require every external account to be configured merely for local lint/typecheck/build if clean mocks/optional infrastructure boundaries can keep Phase 0 verifiable.

---

## 13. CI baseline

Create GitHub Actions workflow(s) so pull requests can run at least:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Include migration/schema validation if the Phase 0 database package supports it without requiring production secrets.

Prefer deterministic, cache-friendly workspace commands.

---

## 14. Repository quality

Required:

- `.gitignore`
- formatting/lint configuration
- strict TypeScript base configuration
- workspace-level scripts
- README with local setup and command overview
- no committed generated secrets/build artifacts
- package dependency boundaries that avoid circular architecture
- no dead starter-template code unrelated to Academic Precision

---

## 15. Phase 0 prohibitions

Do not implement:

- signup/login/onboarding flows beyond provider/config placeholders;
- Workspace business creation logic;
- Membership/RBAC;
- Groups/Months/Sessions;
- Students/Guardians/Enrollment/QR;
- Finance/Payments;
- Attention/Follow-up;
- Subscription/Billing behavior;
- Reports/Notifications/Action Center;
- Center Product;
- speculative APIs or database tables not authorized for Phase 0.

Do not add Firebase/Firestore or replace PostgreSQL/Supabase decisions.

---

## 16. Definition of Done

Phase 0 passes only when all applicable items are true:

- [ ] Approved monorepo structure exists and is coherent.
- [ ] `apps/web` builds successfully.
- [ ] `apps/api` builds successfully using NestJS + Fastify.
- [ ] `apps/worker` builds successfully as a separate process.
- [ ] shared packages compile without circular or illegal dependencies.
- [ ] TypeScript strict mode is enabled and passes.
- [ ] lint passes.
- [ ] tests pass.
- [ ] production build passes.
- [ ] CI workflow reflects the same core checks.
- [ ] database package is migration-ready and does not use unsafe production auto-sync.
- [ ] API/OpenAPI/error-contract foundations do not conflict with API Contract v1.0.
- [ ] no business feature has been prematurely implemented.
- [ ] no direct frontend business-table database access exists.
- [ ] no secrets are committed.
- [ ] README/local setup is sufficient for a fresh engineer/Claude Code session to run the project.

Required final commands should include, where defined by the workspace:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

If any command fails, Phase 0 status is not COMPLETE unless the failure is an external prerequisite that is explicitly documented as a blocker.

---

## 17. Review Gate

When the Definition of Done is satisfied:

1. produce the Completion Report format from `00_READ_FIRST.md`;
2. list any architectural deviations — expected answer should normally be `none`;
3. list external credentials/accounts still required for later phases;
4. stop.

Do **not** begin Phase 1 automatically.
