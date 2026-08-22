**Academic Precision**

**Teacher V1**

**Implementation Plan & Claude Code Handoff Package**

**v1.0 Approved**

وثيقة تنفيذ هندسية موحدة لتحويل مواصفات المنتج المعتمدة إلى خطة بناء قابلة للتسليم والتنفيذ المرحلي بواسطة Claude Code، دون إعادة تفسير المنتج أو اختراع قواعد جديدة.

| **الحالة —** Approved for Implementation Planning & Claude Code Execution Handoff |
|-----------------------------------------------------------------------------------|

| **الحقل**      | **القيمة**                                                                  |
|----------------|-----------------------------------------------------------------------------|
| النطاق         | Academic Precision — Teacher V1 فقط                                         |
| المستهدف       | Claude Code / Engineering / QA / DevOps                                     |
| تاريخ الاعتماد | 22 أغسطس 2026                                                               |
| قاعدة التنفيذ  | Claude Code ينفذ؛ لا يعيد تصميم المنتج ولا يغيّر المعمارية                   |
| المرجع الأعلى  | PRD V1.1 Final ثم Technical Architecture ثم Database Schema ثم API Contract |

# **1. مصدر الحقيقة وحدود السلطة**

ترتيب المصادر الملزم عند أي تعارض:

**•** Business Rules وAcceptance Criteria داخل PRD V1.1 Final.

**•** Technical Architecture v1.0 Approved وقرارات ADRs.

**•** Database Schema v1.0 Approved: العلاقات، القيود، الفهارس، RLS، المعاملات.

**•** API Contract v1.0 Approved: الحدود الخارجية، DTOs، الأخطاء، idempotency، permissions.

**•** Stitch / Design Reference + Design Tokens + UI Contract للشكل والتفاعل.

**•** Implementation Plan الحالي لترتيب التنفيذ وGates، وليس لتغيير قواعد المنتج.

| **قاعدة حاسمة —** أي سلوك جوهري غير موجود في المراجع المعتمدة يُسجَّل BLOCKED — Product Decision Required، ولا يتم اختراعه داخل الكود. |
|-------------------------------------------------------------------------------------------------------------------------------------|

# **2. هدف الحزمة**

**•** تحويل المنتج إلى مراحل تنفيذ مستقلة وقابلة للاختبار.

**•** منع بناء Big Bang يصعب مراجعته أو التراجع عنه.

**•** جعل كل Phase لها Preconditions وDeliverables وStop/Review Gate وDefinition of Done.

**•** حماية الـMulti-tenancy والصلاحيات والمالية والتاريخ التشغيلي قبل إضافة الواجهات الثانوية.

**•** إبقاء النظام قابلًا للتوسع لآلاف المدرسين ثم Center Workspaces مستقبلًا من غير إعادة بناء الأساس.

# **3. بنية حزمة التسليم**

> handoff/  
> 00_READ_FIRST.md  
> 01_PRD_V1.1_FINAL.docx  
> 02_TECHNICAL_ARCHITECTURE_V1.0_APPROVED.docx  
> 03_DATABASE_SCHEMA_V1.0_APPROVED.docx  
> 04_API_CONTRACT_V1.0_APPROVED.docx  
> 05_DESIGN_REFERENCE.md  
> 06_DESIGN_TOKENS.md  
> 07_IMPLEMENTATION_PLAN.md  
> 08_ENGINEERING_GUARDRAILS.md  
> 09_PHASES/  
> 10_QA_GOLDEN_FLOW.md  
> 11_RELEASE_CHECKLIST.md  
> MASTER_CLAUDE_CODE_PROMPT.md

# **4. استراتيجية التنفيذ المرحلي**

| **Phase** | **الاسم**                               | **الهدف**                                                                      |
|-----------|-----------------------------------------|--------------------------------------------------------------------------------|
| 0         | Repository & Foundation                 | Monorepo، tooling، CI، environments، contracts skeleton                        |
| 1         | Identity / Auth / Workspace             | Supabase Auth، User، Workspace، Owner Membership، onboarding                   |
| 2         | RBAC / Membership / Permissions         | Permission Catalog، Group Scope، server-side authorization، RLS boundary       |
| 3         | Months / Groups / Scheduling            | OperatingMonth، Group، GroupMonth، ScheduleRule، Session generation/reschedule |
| 4         | Students / Guardians / Enrollment       | Student ثابت، Guardian M:N، Enrollment شهري، QR، proration                     |
| 5         | Session Mode                            | Start → Attendance → Homework → Optional Exam → Review → Complete              |
| 6         | Finance                                 | Obligations، ledger payments، reversals، collection queue                      |
| 7         | Attention & Follow-up                   | Rule engine deterministic، AttentionCase، ContactLog، defer queue              |
| 8         | Subscription & Entitlements             | Trial، Paddle adapter، webhook source-of-truth، read-only expiry               |
| 9         | Reports / Notifications / Action Center | CSV reports، in-app notifications، read models                                 |
| 10        | Hardening / QA / Scale / Release        | Security، observability، load tests، backup/restore، pilot readiness           |

| **قاعدة الانتقال —** لا يبدأ Phase جديد قبل اجتياز Stop/Review Gate للمرحلة السابقة. يجوز العمل المتوازي فقط في أعمال لا تمس Domain أو Schema أو Contracts المعتمدة. |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# **5. Stop / Review Gate الموحد**

**•** كل migrations الخاصة بالمرحلة طبقت بنجاح على Development وStaging.

**•** Lint + Typecheck + Unit + Integration + Contract tests ناجحة.

**•** لا يوجد P0/P1 defect معروف داخل نطاق المرحلة.

**•** الـOpenAPI/Contracts محدثة لأي endpoint جديد.

**•** Authorization وTenant isolation مغطاة باختبارات سلبية.

**•** Audit/Idempotency/Concurrency مضافة حيث يطلب المرجع.

**•** UI states الأساسية: loading/empty/error/saving/success/disabled والـRTL/mobile إن كانت المرحلة تشمل UI.

**•** لا توجد تغييرات خارج النطاق غير موثقة.

# **Phase 0 — Repository & Foundation**

## **Deliverables**

**•** إنشاء pnpm + Turborepo Monorepo: apps/web, apps/api, apps/worker, packages/ui, contracts, database, config, observability, shared.

**•** Next.js + React + TypeScript للويب؛ NestJS + Fastify للـAPI؛ Worker مستقل؛ Drizzle؛ PostgreSQL؛ Redis/BullMQ؛ Zod/OpenAPI.

**•** TypeScript strict، ESLint/Prettier، GitHub Actions، env validation، Docker للـAPI/Worker.

**•** إنشاء Development/Staging/Production config boundaries من البداية.

## **Definition of Done / Gate**

**•** لا Features تشغيلية، لا Students/Finance، لا fake production logic.

**•** pnpm install/lint/typecheck/test/build كلها ناجحة.

**•** README هندسي واضح وطريقة تشغيل محلية موثقة.

# **Phase 1 — Identity / Auth / Workspace**

## **Deliverables**

**•** Supabase Auth: Email + Password + mandatory email verification.

**•** بعد verification: إنشاء User + Workspace + Owner Membership مرة واحدة بصورة idempotent.

**•** GET /me وworkspace context وOwner Onboarding.

**•** Session expiry/logout/recovery flows بدون كشف وجود الحساب.

## **Definition of Done / Gate**

**•** لا plaintext passwords أو credentials في logs.

**•** Workspace Pending Verification قبل التفعيل.

**•** duplicate verified identity لا تنشئ Workspace ثاني.

**•** كل protected route تتحقق من server-side session.

# **Phase 2 — RBAC / Membership / Permissions**

## **Deliverables**

**•** Memberships، PermissionGrant، PermissionGroupScope، Permission Catalog النهائي.

**•** Auth → Workspace → Active Membership → Permission → Group Scope → Resource.

**•** PostgreSQL RLS للـtenant boundary كدفاع إضافي، مع application authorization كسلطة الصلاحيات.

**•** Team invitations/disable لاحقًا يمكن ربطها بهذه الأسس.

## **Definition of Done / Gate**

**•** External Center Assistant scoped إلى Group A لا يستطيع enumerate أو infer Group B.

**•** payments.record لا يمنح finance.overview.

**•** service_role لا يظهر في Frontend.

**•** اختبارات 403/404 safe-no-leak إلزامية.

# **Phase 3 — Months / Groups / Scheduling**

## **Deliverables**

**•** Group هوية ثابتة؛ GroupMonth إعداد تشغيلي شهري.

**•** OperatingMonth واحد Current لكل Workspace.

**•** ScheduleRules تولد actual calendar occurrences حسب Workspace timezone.

**•** Preview قبل create/apply؛ reschedule يحتفظ بالأصل ويخلق Replacement مرتبطًا؛ cancelled لا يدخل proration.

## **Definition of Done / Gate**

**•** Create Month idempotent + transactional.

**•** completed sessions لا تتحرك بعد schedule change.

**•** Manual extra session غير billable_for_proration افتراضيًا.

**•** اختبارات أشهر 4/5 occurrences وحدود الشهر/timezone.

# **Phase 4 — Students / Guardians / Enrollment**

## **Deliverables**

**•** Student دائم؛ Guardian M:N عبر StudentGuardian؛ Primary واحد فقط لكل Student.

**•** Enrollment يربط Student بـGroupMonth ويحدد join_date/status.

**•** QRCredential opaque + hash only؛ reissue يبطل القديم.

**•** Mid-month preview: Full / Custom / Remaining Sessions.

## **Definition of Done / Gate**

**•** طالب قبل join_date لا يظهر في roster ولا يحسب absent.

**•** proration بالـminor units وhalf-up النهائي فقط.

**•** لا auto-merge لولي الأمر لمجرد نفس الهاتف.

**•** لا duplicate Student أو Group عند الانتقال بين الشهور.

# **Phase 5 — Session Mode**

## **Deliverables**

**•** Start → Attendance → Homework → Optional Exam → Review → Complete.

**•** Batch APIs للحضور/الواجب/الاختبار؛ لا request لكل طالب.

**•** Absence لا يمنع Homework؛ absent_from_exam لا يساوي صفر؛ NO_HOMEWORK حالة محسومة.

**•** Complete Session transaction + outbox; Attention calculation downstream event-driven.

## **Definition of Done / Gate**

**•** complete_session_with_missing_records = false افتراضيًا.

**•** SessionRecord composite integrity يمنع cross-group corruption.

**•** second completion لا يعيد تشغيل side effects.

**•** Optimistic concurrency يمنع silent last-write-wins.

# **Phase 6 — Finance**

## **Deliverables**

**•** FinancialObligation مستقلة لكل Enrollment؛ Payment ledger immutable.

**•** integer minor units فقط؛ no float؛ partial payments؛ no overpayment.

**•** Explicit obligation selection للديون القديمة؛ لا auto allocation.

**•** Reverse/Void عبر سجل موثق؛ لا DELETE للمدفوعات.

## **Definition of Done / Gate**

**•** RecordPayment: lock obligation → validate → idempotency → insert → recalc cached aggregates → audit → outbox → commit.

**•** payment double submit = one transaction.

**•** paid/partial obligation لا تتغير صامتًا بعد fee change.

**•** collection queue تحترم permissions/scope.

# **Phase 7 — Attention & Follow-up**

## **Deliverables**

**•** Rule Engine deterministic: absence/homework/exam.low/combined فقط؛ exam_drop_rule disabled.

**•** AttentionCase واحدة active لكل طالب مع Reasons/Evidence متعددة.

**•** WhatsApp deeplink + editable draft + manual outcome؛ لا auto send ولا delivery claim.

**•** ScheduledFollowUp للـdefer queue.

## **Definition of Done / Gate**

**•** غياب منفرد لا يفتح case.

**•** case تعبر الشهور حتى الإغلاق.

**•** اختيار Guardian فعلي يسجل في ContactLog.

**•** تواصل جديد بعد Contacted/Monitoring يمكن أن يرفع الأولوية دون duplicate case.

# **Phase 8 — Subscription & Entitlements**

## **Deliverables**

**•** 14-day Trial، Active/Expiring/Expired/Payment Failed/Cancelled at period end.

**•** Paddle behind BillingProvider adapter؛ webhook verified هو source of truth.

**•** Entitlement منفصل عن Subscription label وعن Permission.

**•** Expired workspace: history read-only، operational writes blocked.

## **Definition of Done / Gate**

**•** redirect success لا يمنح access.

**•** webhook idempotent.

**•** renewal successful restores access automatically.

**•** no Grace Period في V1.

# **Phase 9 — Reports / Notifications / Action Center**

## **Deliverables**

**•** Student Report، Group Report، Monthly Teacher Report؛ CSV UTF-8 فقط.

**•** In-app notifications: subscription expiry، follow-up due، missing records.

**•** Action Center endpoint/read model: next session، missing، follow-ups، attention، month summary.

**•** Query optimization/read models بدون جعل UI تجمع الحقيقة بنفسها.

## **Definition of Done / Gate**

**•** PDF/XLSX deferred ولا CTA يوحي بهما.

**•** exports permission-scoped + audited.

**•** Action Center لا ينفذ N+1 أو 20 request من الواجهة.

**•** no PII leakage في analytics/notifications.

# **Phase 10 — Hardening / QA / Scale / Release**

## **Deliverables**

**•** RLS tests، rate limits، secret scanning، dependency audit، security headers، PII masking.

**•** Sentry + structured logs + correlation IDs + OTel-ready + queue metrics.

**•** Backups + restore drill، outbox recovery، DLQ/retry verification.

**•** Load tests على session recording/search/payment/month generation/action center.

## **Definition of Done / Gate**

**•** Mobile/RTL regression pass.

**•** Legal/privacy release gate مكتمل قبل public production data collection.

**•** Controlled Pilot أولًا، ثم Private Beta، ثم General Launch.

**•** لا إطلاق عام مع P0/P1 defects.

# **6. MASTER CLAUDE CODE PROMPT — العقد التنفيذي الأعلى**

يُستخدم النص التالي كبداية كل جلسة تنفيذ رئيسية مع Claude Code. لا يستبدل ملفات المرجع؛ بل يفرض طريقة استخدامها.

> You are implementing Academic Precision — Teacher V1 as a production SaaS product, not a one-off project.  
>   
> SOURCE OF TRUTH ORDER  
> 1) PRD V1.1 Final — business rules and acceptance criteria.  
> 2) Technical Architecture v1.0 Approved — architecture and ADRs.  
> 3) Database Schema v1.0 Approved — canonical data model, constraints, RLS, transactions, migrations.  
> 4) API Contract v1.0 Approved — API boundary, DTOs, permissions, errors, idempotency, concurrency.  
> 5) Design reference/tokens/UI contract — visual and interaction implementation.  
> 6) Implementation Plan — execution sequence and review gates.  
>   
> NON-NEGOTIABLE RULES  
> - Implement; do not redesign the product or invent business rules.  
> - If a required product decision is absent or contradictory, STOP and report: BLOCKED — Product Decision Required.  
> - Do not bypass server-side authorization, workspace isolation, group scope, entitlement, audit, idempotency, or concurrency rules.  
> - No direct frontend access to business tables for core workflows.  
> - No business logic in React components or thin controllers.  
> - No float money. Use integer minor units/fixed decimal per approved schema.  
> - No hard delete of operational/financial history.  
> - Do not duplicate Student or Group per month.  
> - Never store raw QR tokens; store hashes only.  
> - No silent last-write-wins.  
> - No auto debt allocation.  
> - No new Center Product features in Teacher V1.  
>   
> BEFORE EACH CHANGE  
> State: source rule, affected modules, DB impact, API impact, permission/scope impact, entitlement impact, audit impact, concurrency/idempotency impact, tests required.  
>   
> WORKFLOW  
> - Work only inside the current approved phase.  
> - Make the smallest coherent implementation batch.  
> - Add/modify migrations through Drizzle only.  
> - Update OpenAPI/contracts with endpoint changes.  
> - Add tests before closing the batch.  
> - Run lint, typecheck, unit, integration, contract tests, and build.  
> - Report files changed, migrations, tests, assumptions, remaining blockers, and exact next step.  
>   
> DEFINITION OF DONE  
> A feature is not done until domain logic, persistence constraints, server authorization, API contract, required audit/idempotency/concurrency, UI states, RTL/mobile checks where applicable, and automated tests are complete.

# **7. Phase Prompt Template**

> PHASE: \<number + name\>  
> GOAL: \<approved goal from Implementation Plan\>  
>   
> READ FIRST  
> - Relevant PRD sections  
> - Relevant Technical Architecture/ADRs  
> - Relevant Database Schema tables/constraints/transactions  
> - Relevant API Contract endpoints/errors/permissions  
> - Relevant design screens/tokens  
>   
> IMPLEMENT ONLY  
> - \<approved deliverables\>  
>   
> DO NOT IMPLEMENT  
> - Anything from later phases unless strictly required as an agreed dependency.  
> - Any new business behavior not in the sources.  
>   
> BEFORE CODING  
> 1. Inspect the current repository and report what already exists.  
> 2. Map requested work to the source-of-truth rules.  
> 3. List DB/API/AuthZ/Audit/Idempotency/Concurrency impacts.  
> 4. Identify blockers. If none, proceed.  
>   
> EXECUTION  
> - Implement in small coherent commits.  
> - Preserve module boundaries.  
> - Add Drizzle migrations only when needed.  
> - Add/update OpenAPI and shared contracts.  
> - Add tests including negative authorization and edge cases.  
>   
> STOP/REVIEW GATE  
> Run lint, typecheck, tests, build and phase-specific acceptance scenarios.  
> Return: implemented scope, changed files, migrations, test results, unresolved issues, and whether PHASE GATE = PASS or FAIL.

# **8. Engineering Guardrails**

| **ممنوع**                                        | **السبب / البديل**                                       |
|--------------------------------------------------|----------------------------------------------------------|
| Direct frontend DB access للـcore business flows | كل العمليات تمر عبر Stable Product API وحدود الصلاحيات.  |
| Business logic داخل React أو Controller          | ضعها في Domain/Application use cases.                    |
| Float للأموال                                    | استخدم minor units/fixed Decimal فقط.                    |
| Hard delete للتاريخ التشغيلي/المالي              | Archive/Withdraw/Cancel/Reverse/Revoke حسب الكيان.       |
| Student أو Group جديد كل شهر                     | Student وGroup ثابتان؛ Enrollment وGroupMonth شهريان.    |
| Raw QR token في DB                               | خزن token hash فقط.                                      |
| Client-side permissions كحماية                   | Server AuthZ + scope + RLS defense-in-depth.             |
| Silent last-write-wins                           | Optimistic concurrency + 409 conflict.                   |
| Auto allocation للديون                           | اختيار Obligation صريح.                                  |
| Schema edits يدويًا في Production                 | Drizzle forward-only migrations.                         |
| Generic CRUD APIs للعمليات الحساسة               | Domain commands مثل completeSession/recordPayment.       |
| ميزة Center داخل Teacher V1                      | احفظ architecture center-ready فقط دون Product features. |

# **9. Git / PR / Commit Workflow**

**•** main protected؛ لا direct push.

**•** Branches صغيرة وواضحة: feature/auth-owner-onboarding، feature/session-attendance، feature/finance-payments…

**•** Commits دلالية: feat(auth): … / test(authz): … / fix(session): …

**•** كل PR يرفق: scope، source rules، migrations، API changes، screenshots عند UI، test evidence، security/tenant impact.

**•** PR Gate: lint + typecheck + unit + integration + contract + build + migration validation؛ E2E للـGolden Flows الحساسة.

# **10. Definition of Done — Feature**

**•** Domain rule implemented وفق المرجع.

**•** DB constraints/indexes/migration مطابقة عند الحاجة.

**•** API + OpenAPI/contracts محدثة.

**•** Authentication/permission/scope/entitlement مطبقة server-side.

**•** Audit/idempotency/concurrency مطبقة حيث يلزم.

**•** UI states والـRTL/mobile مكتملة إن كان لها UI.

**•** Unit + integration + contract tests ناجحة؛ negative tenant/scope tests موجودة.

**•** No P0/P1 defect ضمن النطاق.

# **11. QA Golden Flow**

| **ID** | **السيناريو**                                                       | **النتيجة الإلزامية**                                               |
|--------|---------------------------------------------------------------------|---------------------------------------------------------------------|
| GF-01  | Owner Signup → Verification → Workspace → Onboarding                | Workspace/Membership مرة واحدة؛ لا duplicate identity.              |
| GF-02  | Create Month → GroupMonth → Session generation                      | actual occurrences؛ idempotent transaction.                         |
| GF-03  | Add Student + Guardian + Enrollment mid-month                       | Student ثابت؛ join_date eligibility؛ proration صحيح.                |
| GF-04  | Start Session → Attendance → Homework → Exam → Review → Complete    | batch atomicity؛ absent exam ≠ zero؛ missing policy.                |
| GF-05  | Session completion → AttentionCase → WhatsApp draft → Outcome/Defer | case واحدة متعددة الأسباب؛ ContactLog صحيح.                         |
| GF-06  | Collection Queue → Partial Payment → Reverse                        | ledger immutable؛ no overpayment؛ idempotent.                       |
| GF-07  | Carry Forward New Month                                             | Group ID ثابت؛ GroupMonth جديد؛ history/old debt مستقل.             |
| GF-08  | External Center Assistant scoped Group A                            | لا يرى Group B ولا finance.overview دون grant.                      |
| GF-09  | Subscription expires                                                | history read-only؛ كل operational writes blocked؛ renewal restores. |
| GF-10  | CSV Report Export                                                   | scope respected + audit export.created؛ لا PDF/XLSX.                |

# **12. Phase-specific Acceptance Checklist**

**•** Auth: verification، recovery، session expiry، duplicate-safe workspace creation.

**•** RBAC: permission dependencies، selected group scope، no-leak search/QR/API.

**•** Months/Sessions: calendar generation، reschedule count once، cancelled/proration behavior.

**•** Students: guardian sharing، one primary، QR reissue، join-date roster eligibility.

**•** Session Mode: bulk updates، complete guard، version conflict، idempotent completion.

**•** Finance: partial/reverse، old debt explicit allocation، duplicate submit، paid/partial change protection.

**•** Attention: one active case، evidence pointers، escalation، cross-month lifecycle.

**•** Subscription: trial/expiry matrix، webhook idempotency، read-only expired behavior.

**•** Reports/Action Center: permission scope، indexed queries، no N+1، CSV only.

**•** Release: backup restore، load test، observability، legal/privacy gate.

# **13. Release Strategy**

| **المرحلة**      | **الحجم الإرشادي**          | **شرط الانتقال**                                                             |
|------------------|-----------------------------|------------------------------------------------------------------------------|
| Internal Alpha   | الفريق + Seed/QA workspaces | Golden Flow كامل، لا P0/P1.                                                  |
| Controlled Pilot | 10–30 Teacher Workspaces    | Monitoring + support loop + no tenant/security defects.                      |
| Private Beta     | 100–200 Teachers            | Performance stable، onboarding/retention issues تحت السيطرة.                 |
| General Launch   | توسع تدريجي                 | Security/Legal gates + backups/restore + load tests + operational readiness. |

# **14. Production Readiness Checklist**

## **Security**

☐ Auth verified ☐ Server-side RBAC ☐ RLS tenant isolation ☐ Rate limits ☐ Secrets management ☐ PII masking ☐ Dependency/security scan

## **Reliability**

☐ Idempotency critical commands ☐ Outbox recovery ☐ Queue retries/DLQ ☐ Backups ☐ Restore drill ☐ Migration rollback/forward plan

## **Observability**

☐ Sentry ☐ Structured logs ☐ Correlation IDs ☐ Queue metrics ☐ API latency/error dashboards ☐ Alerting baseline

## **Performance**

☐ Index review ☐ N+1 detection ☐ EXPLAIN ANALYZE hot queries ☐ Load tests ☐ Action Center/read-model performance

## **UX**

☐ RTL regression ☐ Mobile Session Mode ☐ Loading/empty/error states ☐ Expired/permission states ☐ No false offline saved claim

## **Business/Legal**

☐ Paddle webhook verified ☐ Trial/expiry behavior ☐ Privacy Notice/Terms ☐ Legal/privacy release gate

# **15. Claude Code Completion Report Template**

| **الحقل**                           | **المطلوب في التقرير**                                               |
|-------------------------------------|----------------------------------------------------------------------|
| Phase / Batch                       | اسم المرحلة أو الدفعة التنفيذية.                                     |
| Status                              | PASS / FAIL / BLOCKED.                                               |
| Source Rules Used                   | المراجع والقواعد التي استند إليها التنفيذ.                           |
| Implemented                         | ما تم تنفيذه فعليًا فقط.                                              |
| Files Changed                       | قائمة الملفات الأساسية التي تغيرت.                                   |
| Database / Migrations               | المigrations وأثر الـschema إن وجد.                                  |
| API / Contracts                     | Endpoints / DTOs / OpenAPI changes.                                  |
| Authorization / Entitlement / Scope | أثر الصلاحيات والـtenant boundaries.                                 |
| Audit / Idempotency / Concurrency   | ما تم تطبيقه من المتطلبات الحساسة.                                   |
| Tests Run                           | lint, typecheck, unit, integration, contract, e2e, build مع النتائج. |
| Risks / Blockers                    | المشكلات أو القرارات المطلوبة.                                       |
| Phase Gate                          | PASS أو FAIL.                                                        |
| Next Exact Step                     | الخطوة التالية المحددة بلا غموض.                                     |

# **16. Definition of Ready — Implementation Handoff**

| **البند**                   | **الحالة** |
|-----------------------------|------------|
| PRD V1.1 Final              | Approved   |
| Technical Architecture v1.0 | Approved   |
| ADRs                        | Closed     |
| Database Schema v1.0        | Approved   |
| API Contract v1.0           | Approved   |
| Implementation phases       | Closed     |
| Master Claude Code Prompt   | Closed     |
| Phase Prompt Template       | Closed     |
| Engineering Guardrails      | Closed     |
| Golden Flow / QA gates      | Closed     |
| Release Checklist           | Closed     |

| **الحالة النهائية —** Implementation Plan & Claude Code Handoff: APPROVED. لا يبدأ التنفيذ إلا مع إتاحة ملفات المرجع وتصميمات Stitch/Design Tokens داخل المستودع أو مجلد handoff. |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# **17. الخطوة التالية التنفيذية**

**بعد وضع هذه الحزمة وملفات المرجع داخل المستودع، يبدأ Claude Code بـPhase 0 فقط. عند اجتياز Gate يتم الانتقال إلى Phase 1 ثم بالتتابع. لا توجد حاجة لإعادة فتح Product Definition أو Architecture إلا عند Change Request حقيقي.**

**Teacher V1 — Implementation Handoff Definition: CLOSED**
