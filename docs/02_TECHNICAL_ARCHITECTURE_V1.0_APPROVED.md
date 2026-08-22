**Academic Precision**

**Teacher V1 — Technical Architecture**

**Technical Architecture v1.0 — Approved**

**مرجع المنتج الحاكم: Academic Precision — Teacher V1 — PRD V1.1 Final**

الغرض: تثبيت المعمارية التقنية لمنتج عالمي قابل للتوسع، مع الحفاظ على بساطة النشر في البداية وقابلية النمو إلى آلاف المدرسين والسناتر والفروع والملايين من السجلات دون إعادة بناء جوهر المنتج.

| **الحقل**             | **القيمة**                                                                          |
|-----------------------|-------------------------------------------------------------------------------------|
| الحالة                | Approved — ADRs Closed — Ready for Database Schema & API Contracts                  |
| النطاق                | Teacher V1 Architecture مع Center-ready foundations لمنتج عالمي متعدد الـWorkspaces |
| المستهدف              | Claude Code / Engineering / QA / DevOps / Security                                  |
| المبدأ                | Build the domain for scale. Deploy it simply.                                       |
| مصدر الحقيقة المنتجية | PRD V1.1 Final؛ المعمارية لا تغيّر Business Rules                                    |

# 1. المبادئ المعمارية الحاكمة

- Product Architecture وليس Project Architecture: تصميم الأساس ليستمر مع نمو المنتج والسناتر والفروع والمستخدمين دون ربطه بعميل واحد.

- Modular Monolith أولًا: حدود Domain واضحة داخل Backend واحد بدل Microservices مبكرة ومعقدة.

- Event-Driven Background Processing: العمليات الثانوية والمكلفة تعمل عبر Events/Queues ولا تعطل العمليات الأساسية.

- PostgreSQL هو Source of Truth للبيانات التشغيلية والمالية؛ Redis ليس مصدر حقيقة.

- Server-side authorization إلزامي؛ إخفاء عناصر الواجهة لا يعتبر حماية.

- Workspace هو حد العزل Multi-Tenant من البداية، مع تصميم يسمح مستقبلًا بـCenter Workspace دون كسر Teacher V1.

- Financial integrity وhistorical integrity مقدمان على سهولة الحذف أو التعديل الصامت.

- Observability وAudit وIdempotency وConcurrency جزء من المعمارية الأساسية وليست إضافات لاحقة.

# 2. النمط المعماري العام

القرار النهائي: Modular Monolith + Event-Driven Background Processing.

يتم نشر المنتج مبدئيًا في وحدات قليلة: Web + API + Worker، بينما يتم فصل الـDomain داخليًا إلى Modules واضحة يمكن فصلها مستقبلًا إلى Services مستقلة عند وجود سبب تشغيلي فعلي.

| **الطبقة**     | **الدور**                                                                            |
|----------------|--------------------------------------------------------------------------------------|
| Web / Frontend | واجهة عربية RTL، Desktop + Mobile Web/PWA، تنفيذ UX دون حمل Business Logic حاسمة.    |
| API / Backend  | Domain rules، authorization، transactions، idempotency، API contract.                |
| Worker         | session generation، attention recalculation، notifications، reports، scheduled jobs. |
| PostgreSQL     | Source of Truth؛ relational integrity، transactions، reports.                        |
| Redis          | Queue/cache/rate limit/locks/idempotency support؛ ليس Source of Truth.               |
| Object Storage | ملفات وتقارير وأصول مستقبلية عبر S3-compatible abstraction.                          |

# 3. الوحدات Domain Modules

كل Module يجب أن يملك Domain/Application/Infrastructure/API boundaries واضحة. لا يسمح لوحدة بأن تعتمد على تفاصيل داخلية لوحدة أخرى مباشرة؛ التفاعل عبر Application contracts أو Domain Events.

- Identity

- Workspace

- Membership & Permissions

- Students

- Guardians

- Groups

- Months

- Sessions

- Attendance

- Homework

- Exams

- Attention

- Follow-up

- Finance

- Subscriptions & Entitlements

- Reports

- Notifications

- Audit

# 4. Frontend Architecture

**Stack المقترح: Next.js + React + TypeScript + Tailwind + Internal Design System.**

- App Router؛ Server Components حيث تفيد، وClient Components فقط عندما يوجد تفاعل فعلي.

- TanStack Query لإدارة server state المعقدة، React Hook Form + Zod للنماذج والتحقق.

- RTL-first من الجذر، Mobile-first حيث التشغيل الميداني خصوصًا Session Mode.

- لا Business Logic مالية/صلاحيات/Entitlements في React components؛ الواجهة تعرض قرار Backend فقط.

- Component system مطابق لمرجع Stitch/16 Reference Screens وDesign Tokens.

# 5. Backend Architecture

**Stack المقترح: NestJS + Fastify + TypeScript.**

يفضل Backend مستقل عن Next.js لأن المنتج يحتوي RBAC/Schedules/Financial Transactions/Workers/Audit/Subscriptions/Center-ready expansion. Controllers رفيعة؛ Business Rules داخل Domain/Application services.

| **مجلد Module نموذجي** | **المحتوى**                                                   |
|------------------------|---------------------------------------------------------------|
| domain/                | Entities, value objects, invariants, domain services, events  |
| application/           | Use cases/commands/queries, transaction boundaries            |
| infrastructure/        | Repositories, DB adapters, queue/storage/integration adapters |
| api/                   | Controllers, DTOs, authorization guards, OpenAPI              |

# 6. Database & Multi-Tenancy

**قاعدة البيانات الأساسية: PostgreSQL.**

- كل البيانات التشغيلية تعزل بالـWorkspace؛ الوصول يُستنتج من authenticated user + membership + permission + scope.

- لا يُوثق workspace_id القادم من العميل كحقيقة صلاحية؛ Backend يفرض السياق من Session/Membership.

- يستخدم Foreign Keys وUnique Constraints وTransactions لتثبيت الـCanonical Data Model الموجود في PRD.

- RLS في PostgreSQL يمكن استخدامه Defense-in-Depth خصوصًا مع Supabase، لكنه لا يستبدل Domain Authorization.

- الجداول الثقيلة مستقبلًا قد تستخدم partitioning بعد وجود Metrics حقيقية، لا من أول يوم بلا داعٍ.

# 7. Center-ready Foundations دون بناء Center Product

Teacher V1 لا يبني Center Workspace الآن، لكن لا يجوز أن تفترض المعمارية أن Workspace سيظل دائمًا “مدرسًا فرديًا”.

**المستقبل المتوقع: Workspace يمكن أن يتطور لأنواع مثل TEACHER وCENTER، مع Membership/Permission/Scope يتوسع لاحقًا إلى Branch/Group/Student scopes. يتم ذلك بعد Center Discovery دون تغيير أسس Student/Session/Finance.**

# 8. Session Engine

- توليد Sessions يتم في Backend/Domain Service من GroupMonth + ScheduleRules + Workspace timezone + OperatingMonth.

- لا يوجد عدد حصص ثابت؛ يتم حساب occurrences الفعلية داخل الشهر.

- Reschedule يحتفظ بالجلسة الأصلية ويولد replacement مرتبطة بها، ولا تُحسب مرتين.

- التعديلات على الجداول المستقبلية تُظهر Impact Preview؛ completed sessions لا تتحرك.

- Session completion يجب أن يكون idempotent ولا يعيد تشغيل effects عند إعادة الطلب.

# 9. Queue & Background Jobs

**Queue المقترحة: Redis + BullMQ.**

| **Job / Event**             | **الاستخدام**                             |
|-----------------------------|-------------------------------------------|
| GenerateMonthSessions       | توليد حصص الشهر                           |
| SessionCompleted            | تشغيل projections والـAttention والتقارير |
| RecalculateStudentAttention | تحديث الحالة الموحدة للطالب               |
| FollowUpDueNotification     | إشعار المتابعات المستحقة                  |
| SubscriptionExpiryCheck     | حساب/إشعار انتهاء الاشتراك                |
| GenerateReport              | إنشاء تصديرات مستقبلية/CSV الثقيلة        |
| MissingRecordsScan          | فحص الحالات الناقصة عند الحاجة            |

# 10. Event-Driven Internal Architecture

تمنع المعمارية أن تتحول عملية CompleteSession إلى سلسلة متشابكة من استدعاءات مباشرة. بدلًا من ذلك تصدر Domain Event مثل SessionCompleted وتستمع لها وحدات Attention/Reporting/Notifications/Analytics.

**في البداية Event Bus داخلي؛ يمكن فصل بعض المستهلكين لاحقًا إلى messaging infrastructure أكبر دون إعادة تصميم الـDomain.**

# 11. Transactional Outbox

يُعتمد Transactional Outbox للـEvents المهمة. داخل نفس DB transaction يتم حفظ التغيير التشغيلي وOutboxEvent؛ Worker ينشره لاحقًا. الهدف منع فقد حدث بعد نجاح الـDB write وقبل إرساله للـqueue.

# 12. Financial Architecture

**Ledger-first. FinancialObligation + Payment هو Source of Truth المالي.**

- لا paid=true ولا amount_paid كحقل وحيد يمثل الحقيقة.

- Payments تتحول Posted → Voided/Reversed ولا تُحذف.

- الأموال تخزن integer minor units (piastres) أو fixed Decimal؛ ممنوع binary floating point.

- لا Overpayment credits في V1؛ لا توزيع دفعة بين استحقاقات بدون اختيار صريح.

- كل command مالي حساس idempotent + auditable + permission-checked.

# 13. Idempotency & Concurrency

| **العملية**      | **القاعدة**                                                                |
|------------------|----------------------------------------------------------------------------|
| Payment confirm  | Idempotency key؛ duplicate submit يعيد نفس النتيجة ولا ينشئ Payment ثانية. |
| Create Month     | Transactional + idempotent؛ كل artifacts تنشأ أو لا ينشأ شيء.              |
| Complete Session | Transition guard + idempotency؛ effects مرة واحدة.                         |
| Billing webhook  | Event/provider idempotency؛ redirect لا يمنح entitlement.                  |
| Concurrent edits | Optimistic concurrency عبر version/ETag؛ no silent last-write-wins.        |

# 14. Attention Engine

**V1 يستخدم Deterministic Rule Engine وليس AI.**

مدخلاته SessionCompleted/StudentRecordChanged، ويحدث AttentionCase واحدة نشطة لكل (workspace, student) مع Reasons/Evidence متعددة. الحالة تعبر الشهور حتى الإغلاق، وتتصعد عند استمرار الأدلة بعد Contacted/Monitoring.

# 15. Reporting & Read Models

**V1 reports: Student Report, Group Report, Monthly Teacher Report؛ CSV UTF-8 فقط طبقًا للـPRD. PDF/XLSX مؤجلان.**

في البداية تستخدم PostgreSQL queries/indexes. عند ارتفاع الحمل تُبنى read models/projections مثل workspace_month_summary وstudent_month_summary وgroup_month_summary وcollection_summary عبر Events، بدل حساب كل شيء عند كل فتح للداشبورد.

# 16. Cache & Search

- Redis للـcache/rate limiting/queues/temporary locks فقط؛ سقوط Redis لا يفسد Source of Truth.

- V1 search عبر PostgreSQL مع normalized Arabic columns + indexes؛ Student ID/phone/QR lookups exact حيث يلزم.

- OpenSearch/Elasticsearch مؤجل حتى الحجم الفعلي يبرره؛ يُضاف لاحقًا كSearch Projection دون تغيير الـDomain.

# 17. Authentication & Entitlements

**Product decision ثابت من PRD: Email + Password + mandatory Email Verification. Provider اختيار ADR، ولا نبني custom auth من الصفر.**

Entitlement هو capability gate النهائي server-side. Expired/Payment Failed = read-only operational history، وكل operational writes blocked. Billing provider/webhook source of truth سيتم اختياره في ADR تجاري/تقني.

# 18. Storage & Notifications

- ObjectStorageService abstraction خلف S3-compatible provider؛ لا DB blobs.

- Notifications V1: In-App فقط (expiry, follow-up due, missing records).

- Notification Module يكون channel-oriented ليقبل مستقبلًا Email/Push/WhatsApp دون تفعيلها الآن.

- WhatsApp V1 = user-triggered deeplink + editable draft + saved outcome؛ لا automatic messaging API.

# 19. Audit & Security

- AuditEvent append-only للعمليات الحساسة، مع before/after safe snapshots، actor/time/reason.

- TLS everywhere، secure HTTPOnly/provider sessions، input validation، rate limits، secret management، dependency scanning.

- PII masking حيث لا يلزم العرض الكامل، وعدم وضع passwords/tokens/secrets في logs/audit.

- كل API query/action يتحقق من workspace + active membership + permission + scope؛ منع IDOR إلزامي.

- Backup/restore وforward-only migrations جزء من readiness وليس عمليات يدوية مؤجلة.

# 20. API Contract

**REST API versioned عبر /api/v1 + OpenAPI.**

لا Generic CRUD لكل جدول. نستخدم Domain Commands مثل completeSession, recordPayment, carryForwardMonth, reissueQr. كل endpoint يوثق request/response/errors/permission/idempotency/pagination/versioning، وتولد frontend types من العقد.

# 21. Observability & Product Analytics

| **المجال**        | **المقترح**                                            |
|-------------------|--------------------------------------------------------|
| Error tracking    | Sentry                                                 |
| Logs              | Structured JSON + correlation ID                       |
| Tracing           | OpenTelemetry-ready                                    |
| Metrics           | API/DB latency, worker failures, queue lag, error rate |
| Product analytics | PostHog أو equivalent؛ منفصل عن Business DB            |

# 22. Deployment Topology

**القاعدة: Deploy simply. في البداية 3 deployable units فقط: Web + API + Worker.**

| **المكوّن** | **النشر المقترح**                    |
|------------|--------------------------------------|
| Frontend   | Vercel/CDN أو equivalent             |
| API        | Containerized NestJS/Fastify         |
| Worker     | Separate container                   |
| PostgreSQL | Managed provider                     |
| Redis      | Managed provider                     |
| Storage    | S3-compatible managed object storage |

- Docker من أول يوم للـAPI والWorker لتقليل lock-in.

- Environments: Development / Staging / Production، مع أسرار وموارد منفصلة.

- CI/CD لكل PR: lint, typecheck, unit/integration tests, security checks, build. Main: staging, migrations, smoke tests, production deploy.

- DB migrations Forward-only؛ لا تعديل يدوي Production schema.

# 23. Scale Targets & Evolution Path

**Target أولي مرجعي: 1,000 مدرس × متوسط 500 طالب ≈ 500,000 طالب. عند 8 حصص/شهر ≈ 4 مليون student-session records شهريًا. هذا الحجم مناسب لـPostgreSQL المُصمم والمفهرس جيدًا.**

المسار المستقبلي: 10,000+ workspaces، ملايين الطلاب، عشرات الملايين من session records. التوسع يتم تدريجيًا عبر horizontal API scaling، worker specialization، read replicas، read models، partitioning، search service؛ لا نعيد كتابة الـDomain.

| **عند نمو الحمل**  | **الإجراء المحتمل**                                                                 |
|--------------------|-------------------------------------------------------------------------------------|
| API CPU/traffic    | Stateless horizontal scaling                                                        |
| Jobs/queue lag     | Scale workers وفصل worker pools                                                     |
| Heavy reads        | Read replicas + projections/read models                                             |
| Large event tables | Time-based partitioning للجداول المؤهلة                                             |
| Search volume      | OpenSearch/Elasticsearch projection                                                 |
| Global footprint   | CDN أولًا، ثم regional reads/data residency عند الحاجة؛ لا multi-region writes مبكرًا |

# 24. Failure Isolation

تعطل Integrations الثانوية لا يجب أن يسقط Core operations. فشل analytics/report/notification لا يمنع attendance/payment/session completion. Core domains: Students, Sessions, Finance, Permissions تبقى مستقلة عن الخدمات الثانوية synchronous قدر الإمكان.

# 25. Performance Targets

| **المجال**                      | **الهدف**                                    |
|---------------------------------|----------------------------------------------|
| PRD operational reads           | P95 ≤ 2s على اتصال طبيعي                     |
| PRD record save                 | ≈ ≤1s على اتصال طبيعي                        |
| Internal target simple API read | P95 \< 500ms server-side                     |
| Internal target critical writes | P95 \< 700ms excluding network               |
| Action Center backend target    | P95 \< 1s عند وجود read model/indexing مناسب |

# 26. Claude Code Architecture Guardrails

- ممنوع Business Logic حاسمة في React components أو Controllers.

- ممنوع direct DB access من Frontend.

- ممنوع hard delete للـfinancial/operational history التي يمنعها PRD.

- ممنوع tenant-unsafe queries أو الاعتماد على client-side permissions.

- ممنوع float للأموال.

- ممنوع تكرار Student أو Group لكل شهر خلاف الـCanonical Model.

- ممنوع implicit payment allocation أو silent last-write-wins.

- ممنوع اختراع Business Rule/Entity/Permission خارج PRD دون Change Request/ADR مناسب.

# 27. Final Approved Technology Stack

| **المجال**    | **الاختيار النهائي**                                                  |
|---------------|-----------------------------------------------------------------------|
| Frontend      | Next.js + React + TypeScript                                          |
| UI            | Tailwind CSS + Internal Design System                                 |
| Backend       | NestJS + Fastify + TypeScript                                         |
| Database      | PostgreSQL                                                            |
| ORM           | Drizzle ORM                                                           |
| Auth          | Supabase Auth — Email + Password + Email Verification                 |
| Queue/Cache   | Managed Redis + BullMQ                                                |
| Storage       | Cloudflare R2 عبر S3-compatible abstraction                           |
| API           | REST /api/v1 + OpenAPI 3.x                                            |
| Observability | Sentry + Structured JSON Logs + Correlation IDs + OpenTelemetry-ready |
| Analytics     | PostHog مع منع إرسال Student/Guardian PII                             |
| Deployment    | Vercel Web + Render API/Worker + Supabase PostgreSQL + Managed Redis  |

# 28. ADR Closure & Implementation Boundary

تم إغلاق قرارات المعمارية التقنية الأساسية. لا يحتاج Claude Code إلى اختيار Stack أو Provider أو Security Model من نفسه. أي تغيير في قرار معماري معتمد يُسجل كـADR جديد أو Superseding ADR قبل التنفيذ.

- جاهز للمرحلة التالية: Database Schema الفعلي ثم API Contracts ثم Security/Infrastructure implementation details ثم Claude Code Handoff.

- غير داخل هذه المرحلة: كتابة كود المنتج، Center Product features، Microservices، Multi-region writes، Elasticsearch/OpenSearch، PDF/XLSX exports.

# 29. Canonical ADR Register — CLOSED

السجل التالي هو المرجع المعماري الرسمي المختصر. جميع القرارات حالتها Approved ما لم يُذكر صراحة أنها Deferred/Scale-triggered.

| **ADR**     | **القرار**                      | **الخلاصة المعتمدة**                                                                                                                               | **الحالة**   |
|-------------|---------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| **ADR-001** | Architecture Style              | Modular Monolith + Event-Driven Background Processing. Microservices مؤجلة حتى يوجد ضغط تشغيلي مثبت.                                               | **APPROVED** |
| **ADR-002** | Repository Strategy             | Monorepo باستخدام pnpm workspaces + Turborepo؛ apps/web + apps/api + apps/worker + packages مشتركة منضبطة.                                         | **APPROVED** |
| **ADR-003** | Frontend                        | Next.js + React + TypeScript؛ App Router؛ RTL-first؛ TanStack Query؛ React Hook Form؛ Business Logic الحاسمة خارج الواجهة.                         | **APPROVED** |
| **ADR-004** | Backend                         | NestJS + Fastify + TypeScript؛ Controllers رفيعة؛ Use Cases/Domain Rules داخل Application/Domain layers.                                           | **APPROVED** |
| **ADR-005** | Primary Database                | PostgreSQL هو Source of Truth التشغيلي والمالي.                                                                                                    | **APPROVED** |
| **ADR-006** | ORM / SQL Access                | Drizzle ORM؛ يسمح SQL صريح ومختبر للـqueries/locking/indexing المتقدم.                                                                             | **APPROVED** |
| **ADR-007** | Database Provider               | Supabase PostgreSQL كبداية مع Provider Portability؛ لا Supabase-specific Domain coupling.                                                          | **APPROVED** |
| **ADR-008** | Authentication                  | Supabase Auth للهوية فقط؛ Email + Password + mandatory Email Verification؛ Product authorization داخل Backend.                                     | **APPROVED** |
| **ADR-009** | Transactional Email             | Resend عبر Custom SMTP/Email adapter للتفعيل والاستعادة والدعوات والرسائل التشغيلية.                                                               | **APPROVED** |
| **ADR-010** | Queue & Cache                   | Managed Redis + BullMQ؛ Redis ليس Source of Truth؛ queues/rate limit/locks/cache فقط.                                                              | **APPROVED** |
| **ADR-011** | Frontend Hosting                | Vercel للـNext.js Web/CDN/Previews فقط.                                                                                                            | **APPROVED** |
| **ADR-012** | API & Worker Hosting            | Render كبداية لخدمات Containerized API + Worker؛ قابلية نقل لاحقة إلى ECS/Fargate/EKS دون تغيير Domain.                                            | **APPROVED** |
| **ADR-013** | Object Storage                  | Cloudflare R2 عبر S3-compatible ObjectStorageService؛ ممنوع DB blobs.                                                                              | **APPROVED** |
| **ADR-014** | Billing                         | Paddle كبداية خلف BillingProvider adapter؛ webhook/backend confirmation هو Source of Truth؛ redirect وحده لا يمنح Entitlement.                     | **APPROVED** |
| **ADR-015** | API Style                       | REST versioned عبر /api/v1 + OpenAPI 3.x؛ Domain Commands بدل Generic CRUD.                                                                        | **APPROVED** |
| **ADR-016** | Validation & Contracts          | Backend validation هو Authority؛ Frontend validation للـUX؛ DB constraints للنزاهة النهائية؛ shared/generated contracts حيث مناسب.                 | **APPROVED** |
| **ADR-017** | Tenant Isolation                | Server-side AuthZ: workspace + active membership + permission + group scope؛ PostgreSQL RLS كـDefense-in-Depth.                                    | **APPROVED** |
| **ADR-018** | Events & Delivery               | Internal Domain Events + Transactional Outbox من البداية؛ Kafka/RabbitMQ/SQS مؤجلة حتى الحاجة.                                                     | **APPROVED** |
| **ADR-019** | Background Processing           | Workers مستقلة؛ jobs idempotent/retryable/observable مع failure/dead-letter handling.                                                              | **APPROVED** |
| **ADR-020** | Reporting & Read Models         | Dedicated reporting/query layer؛ PostgreSQL أولاً، ثم projections/read models عند ظهور ضغط القراءة.                                                 | **APPROVED** |
| **ADR-021** | Search                          | PostgreSQL normalized Arabic search + indexes/pg_trgm عند الحاجة؛ OpenSearch مؤجل للحجم الذي يبرره.                                                | **APPROVED** |
| **ADR-022** | Money                           | Integer minor units (piastres) أو fixed Decimal فقط؛ ممنوع binary float؛ ledger-first.                                                             | **APPROVED** |
| **ADR-023** | Concurrency                     | Optimistic Concurrency عبر version/ETag للسجلات الحساسة؛ ممنوع silent last-write-wins.                                                             | **APPROVED** |
| **ADR-024** | Deletion & Historical Integrity | No Hard Delete للبيانات التشغيلية/المالية الحساسة؛ Archive/Withdraw/Cancel/Void/Reverse/Revoke حسب الكيان.                                         | **APPROVED** |
| **ADR-025** | Audit                           | Append-only AuditEvent للأحداث الحساسة؛ لا passwords/tokens/secrets أو PII غير ضرورية في metadata.                                                 | **APPROVED** |
| **ADR-026** | Observability                   | Sentry + Structured JSON Logs + Correlation IDs + OpenTelemetry-ready metrics/tracing؛ مراقبة queue lag والـAPI/DB latency.                        | **APPROVED** |
| **ADR-027** | Product Analytics               | PostHog للأحداث المنتجية دون Student/Guardian PII؛ analytics failure لا يعطل Core operations.                                                      | **APPROVED** |
| **ADR-028** | CI/CD                           | GitHub Actions: lint/typecheck/tests/build/security checks؛ Staging قبل Production؛ migration gate + smoke tests.                                  | **APPROVED** |
| **ADR-029** | Environments & Secrets          | Development/Staging/Production منفصلة في DB/Auth/Redis/keys؛ secrets خارج Git وفي provider secret stores.                                          | **APPROVED** |
| **ADR-030** | Migrations & Recovery           | Drizzle forward-only migrations؛ لا manual production schema edits؛ managed backups + PITR عند توفره + restore drills.                             | **APPROVED** |
| **ADR-031** | Scaling Strategy                | Stateless API + horizontally scalable workers؛ ثم read replicas/read models/partitioning/search service حسب Metrics، لا مسبقًا.                     | **APPROVED** |
| **ADR-032** | Region Strategy                 | Single Primary Region قريب من السوق والـDB/API/Worker/Redis متقاربة؛ CDN عالمي؛ Multi-region writes مؤجلة.                                         | **APPROVED** |
| **ADR-033** | Center-ready Foundation         | Workspace abstraction لا يساوي Teacher تقنيًا؛ Teacher V1 فقط الآن، مع قابلية توسعة لاحقة إلى CENTER/Branches/Roles/Scopes دون إعادة بناء الأساس.   | **APPROVED** |
| **ADR-034** | Infrastructure as Code          | OpenTofu/Terraform-compatible عند نمو البنية؛ لا يؤخر إطلاق V1 البسيط.                                                                             | **APPROVED** |
| **ADR-035** | Testing                         | Unit + Integration + Contract + E2E Golden Flows؛ اختبارات إلزامية للـpermissions, proration, session generation, idempotency, subscription gates. | **APPROVED** |
| **ADR-036** | Load & Performance              | قياس فعلي قبل Production scale؛ target مرجعي 1,000 teachers ومئات آلاف الطلاب وملايين SessionRecords شهريًا؛ التوسع بالMetrics.                     | **APPROVED** |

# 30. Scale & Product Evolution Contract

هذه المعمارية مصممة كمنتج SaaS عالمي متعدد الـWorkspaces، وليست مشروعًا مخصصًا لعميل واحد. الهدف ليس شراء بنية ضخمة من اليوم الأول، بل تثبيت Domain boundaries وData integrity وTenant isolation بحيث يمكن زيادة القدرة التشغيلية تدريجيًا دون إعادة بناء المنتج.

- المرحلة الأولى: Web + API + Worker + Managed PostgreSQL + Managed Redis + Object Storage.

- عند نمو الحمل: زيادة replicas للـAPI/Workers، read models، read replicas، ثم partitioning والجداول/الخدمات المتخصصة عند ظهور Metrics حقيقية.

- Center Product مستقبلاً يستخدم نفس Workspace/Membership/Permission/Scope/Student/Session/Finance foundations؛ لا يبنى كنظام منفصل يحتاج مزامنة.

- أي Provider قابل للاستبدال عبر Adapter/Port حيث يوجد lock-in محتمل، خصوصًا Billing/Storage/Email/Auth boundaries.

# 31. Architecture Definition of Ready — CLOSED

Technical Architecture v1.0: APPROVED. ADRs الأساسية مغلقة. Product Source of Truth يبقى PRD V1.1 Final، وهذه الوثيقة هي Technical Source of Truth للمعمارية حتى يصدر ADR أحدث يتجاوز قرارًا محددًا.

- المرحلة التالية: Database Schema — الجداول، العلاقات، PK/FK، unique/check constraints، indexes، RLS policies، audit/outbox، money representation، partition-readiness، migration order.

- بعدها: API Contract — endpoints/commands، request/response schemas، permissions، errors، idempotency، pagination، OpenAPI.

- ثم: Security/Infrastructure implementation details + Claude Code Implementation Handoff Package.

- ممنوع بدء Center Product أو اختراع Business Rules جديدة أثناء التنفيذ دون PRD Change Request/ADR مناسب.
