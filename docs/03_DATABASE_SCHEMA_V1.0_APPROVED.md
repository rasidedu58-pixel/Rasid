**Academic Precision**

**Teacher V1 — Database Schema**

**v1.0 Approved — Production-Grade Canonical Database Contract**

| **الغرض —** تحويل PRD والمعمارية التقنية إلى مخطط بيانات علائقي ملزم وقابل للتوسع، يحمي سلامة البيانات والحدود بين الـWorkspaces ويمنع Claude Code أو أي مطور من اختراع علاقات أو قواعد مالية أو صلاحيات خارج المرجع المعتمد. |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

| **الحقل**    | **القيمة**                                                                     |
|--------------|--------------------------------------------------------------------------------|
| الإصدار      | 1.0 Approved                                                                   |
| النطاق       | Academic Precision — Teacher V1 Database Contract                              |
| المحرك       | PostgreSQL (Managed initially via Supabase PostgreSQL)                         |
| ORM          | Drizzle ORM مع السماح بـSQL صريح عند الحاجة                                    |
| المستهدف     | Claude Code / Engineering / QA / Security / Data                               |
| حالة المرحلة | Database Definition CLOSED — Ready for API Contract                            |
| مبدأ التوسع  | Domain correct first; scale via indexes/read models/partitioning when measured |

## ترتيب مصدر الحقيقة

**عند التعارض يكون الترتيب الملزم: Business Rules في PRD → Canonical Product Model → Technical Architecture → Database Schema → API Contract → UI. لا يجوز لمخطط قاعدة البيانات تغيير Product Rule مقفولة؛ إن ظهر تعارض يُرفع Change Request بدل اختراع سلوك.**

# 1. المبادئ الحاكمة لقاعدة البيانات

- PostgreSQL هو Source of Truth للبيانات التشغيلية والمالية. Redis/Cache/Read Models مشتقات أو مسرعات وليست الحقيقة الأساسية.

- Workspace هو حد العزل Multi-Tenant من أول يوم؛ كل كيان تشغيلي حساس إما يحمل workspace_id مباشرة أو يمكن إثبات Workspace الخاص به بعلاقة غير قابلة للالتباس.

- User هو الشخص، Workspace مساحة التشغيل، Membership علاقة الشخص بالمساحة؛ لا نساوي User بالـTenant.

- Group وStudent هويات ثابتة عبر الشهور؛ GroupMonth وEnrollment يمثلان السياق التشغيلي الشهري.

- الأموال لا تخزن binary float. تستخدم integer minor units (piastres) للـEGP أو fixed Decimal عند الحاجة المستقبلية.

- التاريخ التشغيلي والمالي لا يُحذف Hard Delete في المسارات العادية؛ Archive/Withdraw/Cancel/Reverse/Revoke هي الآليات الصحيحة.

- كل timestamps تشغيلية من نوع TIMESTAMPTZ وتخزن UTC؛ التحويل للعرض والحساب الزمني يتم حسب workspace.timezone.

- UUID هو نوع الهوية الأساسي؛ UUIDv7 مفضل Application-side عندما يكون مدعومًا موثوقًا، مع عدم اعتماد الـDomain على خصائص UUIDv7.

- RLS طبقة Defense-in-Depth لعزل Tenant، بينما Permission + Scope enforcement مسؤولية Backend أيضًا.

- الجداول تُصمم للتوسع العالمي دون تنفيذ Partitioning/Microservices مبكرًا بلا Metrics.

# 2. ERD — النموذج المنطقي النهائي

المخطط التالي يوضح العلاقات الأساسية. الأسهم تصف الاعتماد المنطقي، بينما القيود التفصيلية وON DELETE موثقة لاحقًا.

> User ──\< Membership \>── Workspace  
> │ │  
> ├──\< PermissionGrant ──\< PermissionGroupScope \>── Group  
> │ │  
> │ ├──\< OperatingMonth  
> │ ├──\< Location  
> │ ├──\< Group ──\< GroupMonth ──\< ScheduleRule  
> │ │ ├──\< Session ──\< SessionExam  
> │ │ └──\< Enrollment \>── Student  
> │ │ │ ├──\< QRCredential  
> │ │ │ └──\< StudentGuardian \>── Guardian  
> │ │ ├──\< SessionRecord \>── Session  
> │ │ └── FinancialObligation ──\< Payment ── PaymentReversal  
> │ │  
> │ ├──\< AttentionCase ──\< AttentionReason ──\< AttentionEvidence  
> │ │ ├──\< ContactLog  
> │ │ └──\< ScheduledFollowUp  
> │ │  
> │ ├──\< Subscription ──\< Entitlement  
> │ ├──\< WorkspaceInvitation  
> │ ├──\< Notification  
> │ ├──\< AuditEvent  
> │ ├──\< OutboxEvent  
> │ └──\< IdempotencyRecord

| **قاعدة سلامة محورية —** SessionRecord لا يكفي أن يحمل session_id وenrollment_id فقط. يحمل group_month_id أيضًا وتُستخدم Composite Foreign Keys لضمان أن الحصة والتسجيل ينتميان إلى نفس GroupMonth، بحيث تمنع قاعدة البيانات نفسها Cross-Group corruption حتى لو أخطأ Application code. |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 3. معايير الأنواع والقيم

| **المجال**  | **القرار الملزم**                                                                                                                |
|-------------|----------------------------------------------------------------------------------------------------------------------------------|
| Primary IDs | uuid؛ UUIDv7 مفضل عند التوليد من التطبيق، UUIDv4 fallback مقبول.                                                                 |
| Timestamps  | timestamptz NOT NULL افتراضيًا؛ UTC في التخزين.                                                                                   |
| Money       | bigint/integer minor units حسب الحد المتوقع؛ ممنوع float/double.                                                                 |
| Scores      | numeric(8,2) للاختبارات؛ ليست أموالًا.                                                                                            |
| Currency    | char(3) ISO 4217؛ EGP في Teacher V1.                                                                                             |
| Statuses    | text + CHECK constraints بدل PostgreSQL native enum لسهولة migrations/portability.                                               |
| JSONB       | فقط snapshots/metadata غير العلائقية مثل evidence_snapshot وaudit before/after وoutbox payload؛ لا يستخدم بدل العلاقات الأساسية. |
| Version     | integer/bigint version للـoptimistic concurrency في السجلات الحساسة.                                                             |

# 4. Data Dictionary — الهوية والـWorkspace والصلاحيات

## 4.1 users

| **الحقل**               | **النوع/Nullability** | **القاعدة**                                                    |
|-------------------------|-----------------------|----------------------------------------------------------------|
| id                      | uuid PK NOT NULL      | يطابق/يرتبط بهوية Supabase Auth؛ لا Password داخل جدول المنتج. |
| full_name               | text NOT NULL         | اسم العرض الأساسي.                                             |
| email_display           | text NULL             | للعرض فقط عند الحاجة؛ مصدر الهوية AuthIdentity/Provider.       |
| phone                   | text NULL             | اختياري في V1، وليس Authentication method.                     |
| status                  | text NOT NULL         | ACTIVE / DISABLED وفق المسار المعتمد.                          |
| created_at / updated_at | timestamptz NOT NULL  | UTC.                                                           |

## 4.2 workspaces

| **الحقل**                             | **النوع/Nullability**  | **القاعدة**                                  |
|---------------------------------------|------------------------|----------------------------------------------|
| id                                    | uuid PK                | Tenant root.                                 |
| owner_user_id                         | uuid FK users NOT NULL | Owner واحد في Teacher V1.                    |
| name                                  | text NOT NULL          | اسم مساحة التشغيل.                           |
| workspace_type                        | text NOT NULL          | TEACHER فقط في V1؛ CENTER reserved/deferred. |
| locale                                | text NOT NULL          | default ar-EG.                               |
| timezone                              | text NOT NULL          | default Africa/Cairo؛ IANA timezone.         |
| due_date_policy                       | text NOT NULL          | UNIFIED / PER_GROUP.                         |
| unified_due_day                       | smallint NULL          | 1..28 فقط عندما policy=UNIFIED.              |
| status                                | text NOT NULL          | ACTIVE / ARCHIVED عند الحاجة.                |
| created_at / updated_at / archived_at | timestamptz            | archived_at nullable.                        |

**CHECK: (due_date_policy = UNIFIED AND unified_due_day BETWEEN 1 AND 28) OR (due_date_policy = PER_GROUP AND unified_due_day IS NULL).**

## 4.3 memberships

| **الحقل**               | **النوع/Nullability**       | **القاعدة**                                 |
|-------------------------|-----------------------------|---------------------------------------------|
| id                      | uuid PK                     | Membership identity ثابتة للحفاظ على Audit. |
| workspace_id            | uuid FK workspaces NOT NULL | Tenant.                                     |
| user_id                 | uuid FK users NOT NULL      | الشخص المدعو/المالك.                        |
| role_label              | text NOT NULL               | Label وظيفي؛ ليس مصدر الصلاحية وحده.        |
| status                  | text NOT NULL               | INVITED / ACTIVE / DISABLED.                |
| joined_at / disabled_at | timestamptz NULL            | disabled_at مطلوب عند DISABLED.             |
| created_at / updated_at | timestamptz NOT NULL        | —                                           |

**UNIQUE(workspace_id, user_id). تعطيل Membership لا يحذف Actor history.**

## 4.4 permission_grants

| **الحقل**          | **النوع/Nullability** | **القاعدة**                               |
|--------------------|-----------------------|-------------------------------------------|
| id                 | uuid PK               | —                                         |
| workspace_id       | uuid NOT NULL         | Denormalized tenant key للحماية والفهرسة. |
| membership_id      | uuid FK NOT NULL      | Membership المستفيدة.                     |
| permission_key     | text NOT NULL         | من Permission Catalog المعتمد.            |
| scope_type         | text NOT NULL         | ALL_GROUPS / SELECTED_GROUPS.             |
| created_by_user_id | uuid FK NOT NULL      | من منح الصلاحية.                          |
| created_at         | timestamptz NOT NULL  | —                                         |
| revoked_at         | timestamptz NULL      | Soft revoke.                              |

**Partial UNIQUE(membership_id, permission_key) WHERE revoked_at IS NULL.**

## 4.5 permission_group_scopes

| **الحقل**           | **النوع**            | **القاعدة**                              |
|---------------------|----------------------|------------------------------------------|
| id                  | uuid PK              | —                                        |
| permission_grant_id | uuid FK NOT NULL     | يجب أن يكون grant scope=SELECTED_GROUPS. |
| group_id            | uuid FK NOT NULL     | المجموعة المسموحة.                       |
| created_at          | timestamptz NOT NULL | —                                        |

**UNIQUE(permission_grant_id, group_id). لا تستخدم Arrays/JSON للـGroup scope الدائم.**

# 5. Data Dictionary — السياق التشغيلي والمجموعات والشهور

## 5.1 locations

| **الحقل**                             | **النوع**        | **القاعدة**                             |
|---------------------------------------|------------------|-----------------------------------------|
| id                                    | uuid PK          | —                                       |
| workspace_id                          | uuid FK NOT NULL | Tenant scoped.                          |
| name                                  | text NOT NULL    | سنتر/قاعة/منزل/أونلاين كسياق تشغيل فقط. |
| description                           | text NULL        | اختياري.                                |
| status                                | text NOT NULL    | ACTIVE/ARCHIVED.                        |
| created_at / updated_at / archived_at | timestamptz      | —                                       |

## 5.2 operating_months

| **الحقل**                               | **النوع**                  | **القاعدة**                 |
|-----------------------------------------|----------------------------|-----------------------------|
| id                                      | uuid PK                    | —                           |
| workspace_id                            | uuid FK NOT NULL           | —                           |
| year                                    | smallint NOT NULL          | نطاق معقول عبر CHECK.       |
| month                                   | smallint NOT NULL          | 1..12.                      |
| status                                  | text NOT NULL              | DRAFT / CURRENT / ARCHIVED. |
| created_by                              | uuid FK NOT NULL           | —                           |
| created_at / activated_at / archived_at | timestamptz                | حسب الحالة.                 |
| version                                 | integer NOT NULL DEFAULT 1 | Optimistic concurrency.     |

**UNIQUE(workspace_id, year, month). Partial UNIQUE(workspace_id) WHERE status = CURRENT.**

## 5.3 groups

| **الحقل**                             | **النوع**        | **القاعدة**                               |
|---------------------------------------|------------------|-------------------------------------------|
| id                                    | uuid PK          | هوية ثابتة عبر الشهور.                    |
| workspace_id                          | uuid FK NOT NULL | Tenant.                                   |
| name                                  | text NOT NULL    | —                                         |
| subject / grade                       | text NULL        | بيانات تعريفية.                           |
| default_location_id                   | uuid FK NULL     | Default فقط؛ GroupMonth قد يعمل override. |
| status                                | text NOT NULL    | ACTIVE/ARCHIVED.                          |
| created_at / updated_at / archived_at | timestamptz      | —                                         |
| version                               | integer NOT NULL | —                                         |

| **ممنوع —** لا month_id ولا fee ولا schedule داخل groups. هذه خصائص تشغيلية شهرية وتعيش داخل GroupMonth/ScheduleRule. |
|-----------------------------------------------------------------------------------------------------------------------|

## 5.4 group_months

| **الحقل**               | **النوع**               | **القاعدة**                                                 |
|-------------------------|-------------------------|-------------------------------------------------------------|
| id                      | uuid PK                 | —                                                           |
| workspace_id            | uuid FK NOT NULL        | Tenant.                                                     |
| group_id                | uuid FK groups NOT NULL | الهوية الثابتة.                                             |
| operating_month_id      | uuid FK NOT NULL        | الشهر التشغيلي.                                             |
| location_id             | uuid FK NULL            | Override شهري.                                              |
| base_fee_minor          | bigint NOT NULL         | \>=0.                                                       |
| currency_code           | char(3) NOT NULL        | EGP في V1.                                                  |
| due_policy              | text NOT NULL           | UNIFIED / PER_GROUP / OVERRIDE وفق Product mapping النهائي. |
| due_day                 | smallint NULL           | 1..28 عند الحاجة.                                           |
| join_fee_policy         | text NOT NULL           | ASK_EVERY_TIME / FULL / REMAINING وفق قواعد المنتج.         |
| monthly_status          | text NOT NULL           | ACTIVE/ARCHIVED أو ما يعتمده Application.                   |
| created_at / updated_at | timestamptz NOT NULL    | —                                                           |
| version                 | integer NOT NULL        | —                                                           |

**UNIQUE(group_id, operating_month_id). لا تُنشأ Group جديدة عند Carry Forward؛ تُنشأ GroupMonth جديدة فقط.**

## 5.5 schedule_rules

| **الحقل**                     | **النوع**         | **القاعدة**                              |
|-------------------------------|-------------------|------------------------------------------|
| id                            | uuid PK           | —                                        |
| workspace_id                  | uuid NOT NULL     | —                                        |
| group_month_id                | uuid FK NOT NULL  | مصدر التوليد الشهري.                     |
| weekday                       | smallint NOT NULL | 0..6؛ معيار داخلي ثابت ISO-style.        |
| start_time                    | time NOT NULL     | التوقيت المحلي للـWorkspace.             |
| duration_minutes              | integer NOT NULL  | \>0.                                     |
| effective_from / effective_to | date NULL         | لتغييرات مستقبلية داخل الشهر عند الحاجة. |
| created_at / updated_at       | timestamptz       | —                                        |
| version                       | integer NOT NULL  | —                                        |

## 5.6 sessions

| **الحقل**                                | **النوع**                      | **القاعدة**                                                       |
|------------------------------------------|--------------------------------|-------------------------------------------------------------------|
| id                                       | uuid PK                        | —                                                                 |
| workspace_id                             | uuid NOT NULL                  | —                                                                 |
| group_month_id                           | uuid FK NOT NULL               | —                                                                 |
| scheduled_at                             | timestamptz NOT NULL           | UTC؛ محسوب من timezone.                                           |
| duration_minutes                         | integer NOT NULL               | \>0.                                                              |
| status                                   | text NOT NULL                  | SCHEDULED/IN_PROGRESS/COMPLETED/CANCELLED/RESCHEDULED.            |
| origin                                   | text NOT NULL                  | GENERATED/MANUAL/RESCHEDULE_REPLACEMENT.                          |
| rescheduled_from_session_id              | uuid FK sessions NULL          | للجلسة البديلة فقط.                                               |
| billable_for_proration                   | boolean NOT NULL DEFAULT false | Manual extra default false؛ generated billable وفق قواعد التوليد. |
| started_at / completed_at / cancelled_at | timestamptz NULL               | متسقة مع الحالة.                                                  |
| created_by                               | uuid FK NOT NULL               | —                                                                 |
| created_at / updated_at                  | timestamptz NOT NULL           | —                                                                 |
| version                                  | integer NOT NULL               | Concurrency.                                                      |

**Partial UNIQUE(rescheduled_from_session_id) WHERE rescheduled_from_session_id IS NOT NULL. CHECK rescheduled_from_session_id \<\> id. إذا origin=RESCHEDULE_REPLACEMENT يجب أن يكون المرجع غير NULL.**

State transition authority في Domain layer. DB تحمي القيم النهائية والتناسق (مثل COMPLETED ⇒ completed_at IS NOT NULL) ولا تكرر State Machine كاملة في Triggers معقدة.

# 6. Data Dictionary — الطلاب وأولياء الأمور والـQR

## 6.1 students

| **الحقل**                             | **النوع**        | **القاعدة**               |
|---------------------------------------|------------------|---------------------------|
| id                                    | uuid PK          | هوية دائمة.               |
| workspace_id                          | uuid FK NOT NULL | —                         |
| student_code                          | text NOT NULL    | Stable human-facing code. |
| name                                  | text NOT NULL    | —                         |
| search_name_normalized                | text NOT NULL    | للبحث العربي.             |
| status                                | text NOT NULL    | ACTIVE/ARCHIVED.          |
| created_at / updated_at / archived_at | timestamptz      | —                         |
| version                               | integer NOT NULL | —                         |

**UNIQUE(workspace_id, student_code). لا guardian_phone ولا group_id ولا month_id داخل Student.**

## 6.2 guardians

| **الحقل**                             | **النوع**        | **القاعدة**      |
|---------------------------------------|------------------|------------------|
| id                                    | uuid PK          | —                |
| workspace_id                          | uuid FK NOT NULL | —                |
| name                                  | text NULL        | —                |
| phone                                 | text NOT NULL    | قيمة عرض/إدخال.  |
| normalized_phone                      | text NOT NULL    | للبحث والمطابقة. |
| created_at / updated_at / archived_at | timestamptz      | —                |
| version                               | integer NOT NULL | —                |

**INDEX(workspace_id, normalized_phone) وليس UNIQUE في V1؛ النظام يعرض matches المحتملة ولا يعمل merge تلقائيًا.**

## 6.3 student_guardians

| **الحقل**                 | **النوع**        | **القاعدة**                    |
|---------------------------|------------------|--------------------------------|
| id                        | uuid PK          | —                              |
| workspace_id              | uuid NOT NULL    | —                              |
| student_id                | uuid FK NOT NULL | —                              |
| guardian_id               | uuid FK NOT NULL | يمكن مشاركة Guardian بين إخوة. |
| relationship              | text NULL        | —                              |
| is_primary                | boolean NOT NULL | Primary افتراضي للتواصل.       |
| academic_contact_enabled  | boolean NOT NULL | —                              |
| financial_contact_enabled | boolean NOT NULL | —                              |
| created_at / updated_at   | timestamptz      | —                              |

**UNIQUE(student_id, guardian_id). Partial UNIQUE(student_id) WHERE is_primary = true.**

## 6.4 qr_credentials

| **الحقل**                              | **النوع**            | **القاعدة**                      |
|----------------------------------------|----------------------|----------------------------------|
| id                                     | uuid PK              | —                                |
| workspace_id                           | uuid NOT NULL        | —                                |
| student_id                             | uuid FK NOT NULL     | Student ID لا يتغير عند Reissue. |
| token_hash                             | text/bytea NOT NULL  | يخزن hash فقط؛ لا raw token.     |
| status                                 | text NOT NULL        | ACTIVE/REVOKED.                  |
| issued_at / revoked_at                 | timestamptz          | —                                |
| revoke_reason                          | text NULL            | —                                |
| issued_by_user_id / revoked_by_user_id | uuid FK              | —                                |
| created_at                             | timestamptz NOT NULL | —                                |

**Partial UNIQUE(student_id) WHERE status = ACTIVE. QR يحمل opaque high-entropy token بلا PII؛ lookup يتم بعد hashing.**

# 7. Data Dictionary — Enrollment والحصة والاختبار

## 7.1 enrollments

| **الحقل**               | **النوع**        | **القاعدة**                                   |
|-------------------------|------------------|-----------------------------------------------|
| id                      | uuid PK          | —                                             |
| workspace_id            | uuid NOT NULL    | —                                             |
| student_id              | uuid FK NOT NULL | هوية الطالب.                                  |
| group_month_id          | uuid FK NOT NULL | سياق المجموعة للشهر.                          |
| join_date               | date NOT NULL    | يحدد roster eligibility.                      |
| status                  | text NOT NULL    | PENDING/ACTIVE/STOPPED/WITHDRAWN/TRANSFERRED. |
| fee_method              | text NOT NULL    | FULL_MONTH/CUSTOM/REMAINING_SESSIONS.         |
| custom_fee_minor        | bigint NULL      | فقط عند CUSTOM.                               |
| ended_at                | timestamptz NULL | —                                             |
| end_reason              | text NULL        | —                                             |
| created_at / updated_at | timestamptz      | —                                             |
| version                 | integer NOT NULL | —                                             |

**UNIQUE(student_id, group_month_id). إذا عاد الطالب في نفس GroupMonth يعاد تفعيل/تحديث Enrollment نفسها مع Audit بدل إنشاء سجل ثانٍ متضارب.**

## 7.2 session_exams

| **الحقل**               | **النوع**             | **القاعدة**                          |
|-------------------------|-----------------------|--------------------------------------|
| id                      | uuid PK               | —                                    |
| workspace_id            | uuid NOT NULL         | —                                    |
| session_id              | uuid FK NOT NULL      | اختبار واحد فقط في Session V1.       |
| name                    | text NULL             | —                                    |
| max_score               | numeric(8,2) NOT NULL | \>0.                                 |
| low_score_threshold     | numeric(8,2) NULL     | 0..max؛ rule disabled حتى configure. |
| created_at / updated_at | timestamptz           | —                                    |
| version                 | integer NOT NULL      | —                                    |

**UNIQUE(session_id). absent_from_exam ليست score=0.**

## 7.3 session_records

| **الحقل**               | **النوع**         | **القاعدة**                                        |
|-------------------------|-------------------|----------------------------------------------------|
| id                      | uuid PK           | —                                                  |
| workspace_id            | uuid NOT NULL     | Tenant.                                            |
| group_month_id          | uuid NOT NULL     | Integrity anchor.                                  |
| session_id              | uuid NOT NULL     | Composite FK مع group_month_id.                    |
| enrollment_id           | uuid NOT NULL     | Composite FK مع group_month_id.                    |
| attendance_status       | text NULL         | PRESENT/ABSENT/LATE؛ NULL أثناء draft = missing.   |
| homework_status         | text NULL         | DONE/PARTIAL/NOT_DONE/NO_HOMEWORK؛ NULL = missing. |
| exam_status             | text NULL         | NO_EXAM/SCORED/ABSENT_FROM_EXAM.                   |
| exam_score              | numeric(8,2) NULL | فقط عند SCORED.                                    |
| notes                   | text NULL         | —                                                  |
| created_by / updated_by | uuid FK           | —                                                  |
| created_at / updated_at | timestamptz       | —                                                  |
| version                 | integer NOT NULL  | Concurrency.                                       |

**UNIQUE(session_id, enrollment_id). sessions UNIQUE(id, group_month_id) + enrollments UNIQUE(id, group_month_id) ثم Composite FKs من session_records لمنع ربط Enrollment من GroupMonth مختلفة.**

**CHECK: exam_status=SCORED ⇒ exam_score IS NOT NULL؛ وإلا exam_score IS NULL. exam_score\>=0؛ الحد الأعلى مقابل session_exams.max_score يتحقق في Domain/Application داخل transaction.**

## 7.4 Missing Records كـDerived Model

**لا يوجد جدول Canonical اسمه MissingRecord يكون Source of Truth. النقص مشتق من SessionRecord وحالة Session/Policy. عند الحاجة للسرعة يمكن إنشاء Projection/Read Model مثل missing_record_items، ويظل قابلًا لإعادة البناء من البيانات الأصلية.**

# 8. Data Dictionary — Finance Ledger

## 8.1 financial_obligations

| **الحقل**                 | **النوع**                 | **القاعدة**                                          |
|---------------------------|---------------------------|------------------------------------------------------|
| id                        | uuid PK                   | —                                                    |
| workspace_id              | uuid NOT NULL             | —                                                    |
| enrollment_id             | uuid FK NOT NULL          | Obligation شهرية واحدة في Teacher V1.                |
| currency_code             | char(3) NOT NULL          | EGP.                                                 |
| base_fee_minor            | bigint NOT NULL           | \>=0.                                                |
| discount_minor            | bigint NOT NULL DEFAULT 0 | \>=0.                                                |
| waiver_minor              | bigint NOT NULL DEFAULT 0 | \>=0.                                                |
| net_due_minor             | bigint NOT NULL           | base-discount-waiver.                                |
| due_date                  | date NOT NULL             | —                                                    |
| amount_paid_minor         | bigint NOT NULL DEFAULT 0 | Cached aggregate؛ transactional.                     |
| remaining_minor           | bigint NOT NULL           | Cached aggregate؛ transactional.                     |
| status                    | text NOT NULL             | UNPAID/PARTIAL/PAID. Overdue مشتق من date+remaining. |
| calculation_basis         | text NOT NULL             | FULL/CUSTOM/REMAINING + basis.                       |
| calculation_snapshot_json | jsonb NULL                | Formula preview/auditable basis.                     |
| created_at / updated_at   | timestamptz               | —                                                    |
| version                   | integer NOT NULL          | —                                                    |

**UNIQUE(enrollment_id). CHECK discount+waiver\<=base؛ net_due=base-discount-waiver؛ amount_paid\>=0؛ remaining\>=0؛ amount_paid+remaining=net_due.**

| **مصدر الحقيقة المالي —** Payment ledger + FinancialObligation هما الحقيقة. amount_paid_minor وremaining_minor وstatus داخل Obligation مسموح بها كـcached aggregates للأداء، لكن لا تتغير إلا Transactionally داخل Finance Domain ويمكن التحقق منها من ledger. |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 8.2 payments

| **الحقل**           | **النوع**            | **القاعدة**                                                              |
|---------------------|----------------------|--------------------------------------------------------------------------|
| id                  | uuid PK              | Immutable ledger identity.                                               |
| workspace_id        | uuid NOT NULL        | —                                                                        |
| obligation_id       | uuid FK NOT NULL     | اختيار صريح للاستحقاق.                                                   |
| amount_minor        | bigint NOT NULL      | \>0 ولا يتجاوز remaining وقت transaction.                                |
| currency_code       | char(3) NOT NULL     | يطابق obligation.                                                        |
| method              | text NOT NULL        | CASH/TRANSFER/WALLET/OTHER.                                              |
| paid_at             | timestamptz NOT NULL | —                                                                        |
| status              | text NOT NULL        | POSTED/REVERSED (VOID يمكن تمثيله وفق implementation mapping إن استُخدم). |
| note                | text NULL            | —                                                                        |
| idempotency_key     | text NOT NULL        | من client confirmation.                                                  |
| recorded_by_user_id | uuid FK NOT NULL     | —                                                                        |
| created_at          | timestamptz NOT NULL | لا update مالي صامت.                                                     |

**UNIQUE(workspace_id, idempotency_key). ممنوع overpayment وممنوع automatic allocation بين التزامات.**

## 8.3 payment_reversals

| **الحقل**                | **النوع**            | **القاعدة**                 |
|--------------------------|----------------------|-----------------------------|
| id                       | uuid PK              | —                           |
| workspace_id             | uuid NOT NULL        | —                           |
| payment_id               | uuid FK NOT NULL     | Payment الأصلية تظل محفوظة. |
| reason                   | text NOT NULL        | إلزامي.                     |
| reversed_by_user_id      | uuid FK NOT NULL     | —                           |
| reversed_at / created_at | timestamptz NOT NULL | —                           |

**UNIQUE(payment_id) في V1؛ Payment لا تُعكس مرتين. Transaction تعيد حساب obligation وتضيف Audit + Outbox.**

# 9. Data Dictionary — Attention والمتابعة والتواصل

## 9.1 attention_cases

| **الحقل**                                   | **النوع**              | **القاعدة**                                  |
|---------------------------------------------|------------------------|----------------------------------------------|
| id                                          | uuid PK                | —                                            |
| workspace_id                                | uuid NOT NULL          | —                                            |
| student_id                                  | uuid FK NOT NULL       | حالة واحدة نشطة لكل طالب.                    |
| status                                      | text NOT NULL          | NEW/IN_FOLLOWUP/CONTACTED/MONITORING/CLOSED. |
| priority                                    | text/smallint NOT NULL | Mapped إلى ملاحظة/يحتاج متابعة/أولوية.       |
| opened_at / last_qualified_at               | timestamptz NOT NULL   | —                                            |
| contacted_at / monitoring_since / closed_at | timestamptz NULL       | حسب الحالة.                                  |
| created_at / updated_at                     | timestamptz            | —                                            |
| version                                     | integer NOT NULL       | —                                            |

**Partial UNIQUE(workspace_id, student_id) WHERE status \<\> 'CLOSED'. الحالة تعبر الشهور ولا تغلق تلقائيًا لمجرد تغير الشهر.**

## 9.2 attention_reasons

| **الحقل**                            | **النوع**              | **القاعدة**              |
|--------------------------------------|------------------------|--------------------------|
| id                                   | uuid PK                | —                        |
| workspace_id                         | uuid NOT NULL          | —                        |
| attention_case_id                    | uuid FK NOT NULL       | —                        |
| rule_key                             | text NOT NULL          | مثل absence.consecutive. |
| severity                             | text/smallint NOT NULL | —                        |
| first_detected_at / last_detected_at | timestamptz NOT NULL   | —                        |
| is_active                            | boolean NOT NULL       | —                        |
| created_at / updated_at              | timestamptz            | —                        |

**UNIQUE(attention_case_id, rule_key). نفس السبب لا يتكرر كسجلات منفصلة؛ Evidence هي التي تتراكم/تتحدث.**

## 9.3 attention_evidence

| **الحقل**           | **النوع**            | **القاعدة**                           |
|---------------------|----------------------|---------------------------------------|
| id                  | uuid PK              | —                                     |
| workspace_id        | uuid NOT NULL        | —                                     |
| attention_reason_id | uuid FK NOT NULL     | —                                     |
| source_type         | text NOT NULL        | SESSION_RECORD/SESSION/...            |
| source_id           | uuid NOT NULL        | Logical/typed source.                 |
| observed_at         | timestamptz NOT NULL | —                                     |
| evidence_snapshot   | jsonb NOT NULL       | أدلة الحدث اللازمة فقط؛ لا dump كامل. |
| created_at          | timestamptz NOT NULL | —                                     |

## 9.4 contact_logs

| **الحقل**                           | **النوع**            | **القاعدة**                                  |
|-------------------------------------|----------------------|----------------------------------------------|
| id                                  | uuid PK              | Immutable snapshot.                          |
| workspace_id                        | uuid NOT NULL        | —                                            |
| student_id / guardian_id            | uuid FK NOT NULL     | Guardian المختار صراحة.                      |
| attention_case_id                   | uuid FK NULL         | —                                            |
| session_id                          | uuid FK NULL         | سياق الحصة عند وجوده.                        |
| channel                             | text NOT NULL        | WHATSAPP_DEEPLINK/CALL/OTHER.                |
| draft_snapshot                      | text NOT NULL        | النص قبل فتح القناة.                         |
| outcome                             | text NOT NULL        | CONTACTED/NO_ANSWER/INVALID_NUMBER/DEFERRED. |
| notes                               | text NULL            | —                                            |
| follow_up_at                        | timestamptz NULL     | مطلوب عند DEFERRED.                          |
| actor_user_id / actor_membership_id | uuid FK              | —                                            |
| created_at                          | timestamptz NOT NULL | —                                            |

## 9.5 scheduled_followups

| **الحقل**                      | **النوع**            | **القاعدة**             |
|--------------------------------|----------------------|-------------------------|
| id                             | uuid PK              | —                       |
| workspace_id                   | uuid NOT NULL        | —                       |
| attention_case_id / student_id | uuid FK NOT NULL     | —                       |
| due_at                         | timestamptz NOT NULL | Queue ordering.         |
| status                         | text NOT NULL        | PENDING/DONE/CANCELLED. |
| assignee_membership_id         | uuid FK NULL         | —                       |
| source_contact_log_id          | uuid FK NULL         | —                       |
| completed_at                   | timestamptz NULL     | —                       |
| created_at / updated_at        | timestamptz          | —                       |
| version                        | integer NOT NULL     | —                       |

# 10. Data Dictionary — Subscription, Entitlement, Invitations, Notifications

## 10.1 subscriptions

| **الحقل**                 | **النوع**        | **القاعدة**                                                           |
|---------------------------|------------------|-----------------------------------------------------------------------|
| id                        | uuid PK          | —                                                                     |
| workspace_id              | uuid NOT NULL    | —                                                                     |
| provider                  | text NOT NULL    | Paddle عبر adapter في المعمارية المعتمدة.                             |
| provider_customer_id      | text NULL        | Unique where non-null/provider scoped.                                |
| provider_subscription_id  | text NULL        | Unique where non-null/provider scoped.                                |
| state                     | text NOT NULL    | TRIAL/ACTIVE/EXPIRING/EXPIRED/PAYMENT_FAILED/CANCELLED_AT_PERIOD_END. |
| period_start / period_end | timestamptz      | —                                                                     |
| cancel_at_period_end      | boolean NOT NULL | —                                                                     |
| created_at / updated_at   | timestamptz      | —                                                                     |
| version                   | integer NOT NULL | —                                                                     |

## 10.2 entitlements

| **الحقل**                     | **النوع**      | **القاعدة**                                                                        |
|-------------------------------|----------------|------------------------------------------------------------------------------------|
| id                            | uuid PK        | —                                                                                  |
| workspace_id                  | uuid NOT NULL  | —                                                                                  |
| capability                    | text NOT NULL  | Product-level gate مثل CORE_OPERATIONS/CREATE_MONTH/REPORT_EXPORT/TEAM_MANAGEMENT. |
| state                         | text NOT NULL  | ALLOWED/BLOCKED أو equivalent.                                                     |
| source_type                   | text NOT NULL  | SUBSCRIPTION/TRIAL/ADMIN.                                                          |
| source_id                     | uuid/text NULL | —                                                                                  |
| effective_from / effective_to | timestamptz    | —                                                                                  |
| created_at / updated_at       | timestamptz    | —                                                                                  |

| **فصل مهم —** Entitlement يجيب: هل الـWorkspace يحق له capability؟ Permission يجيب: هل هذا المستخدم داخل الـWorkspace يحق له الفعل؟ لا يتم دمج المفهومين. |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------|

## 10.3 workspace_invitations

| **الحقل**                | **النوع**            | **القاعدة**                       |
|--------------------------|----------------------|-----------------------------------|
| id                       | uuid PK              | —                                 |
| workspace_id             | uuid NOT NULL        | —                                 |
| email                    | text NOT NULL        | V1 auth = email/password.         |
| role_label               | text NOT NULL        | —                                 |
| token_hash               | text NOT NULL        | لا raw invite token.              |
| status                   | text NOT NULL        | PENDING/ACCEPTED/EXPIRED/REVOKED. |
| expires_at               | timestamptz NOT NULL | —                                 |
| invited_by / accepted_by | uuid FK              | —                                 |
| created_at / accepted_at | timestamptz          | —                                 |

## 10.4 notifications

| **الحقل**               | **النوع**            | **القاعدة**                                         |
|-------------------------|----------------------|-----------------------------------------------------|
| id                      | uuid PK              | —                                                   |
| workspace_id            | uuid NOT NULL        | —                                                   |
| user_id                 | uuid FK NOT NULL     | المتلقي.                                            |
| type                    | text NOT NULL        | SUBSCRIPTION_EXPIRING/FOLLOWUP_DUE/MISSING_RECORDS. |
| title / body            | text NOT NULL        | Arabic-first copy.                                  |
| entity_type / entity_id | text/uuid NULL       | Logical context.                                    |
| read_at                 | timestamptz NULL     | read/unread.                                        |
| created_at              | timestamptz NOT NULL | —                                                   |

# 11. Data Dictionary — Audit, Outbox, Idempotency

## 11.1 audit_events

| **الحقل**                           | **النوع**            | **القاعدة**                                         |
|-------------------------------------|----------------------|-----------------------------------------------------|
| id                                  | uuid PK              | Append-only.                                        |
| workspace_id                        | uuid NOT NULL        | —                                                   |
| actor_user_id / actor_membership_id | uuid NULL            | System actor may be nullable.                       |
| action                              | text NOT NULL        | —                                                   |
| entity_type / entity_id             | text/uuid NOT NULL   | Logical reference؛ لا FK إلزامي للحفاظ على history. |
| before_json / after_json            | jsonb NULL           | Changed fields فقط حيث عملي.                        |
| reason                              | text NULL            | إلزامي لبعض الأفعال مثل reversal.                   |
| correlation_id                      | text/uuid NULL       | ربط request/logs.                                   |
| created_at                          | timestamptz NOT NULL | Immutable.                                          |

**لا passwords/tokens/secrets/raw sensitive PII في metadata. يمنع UPDATE/DELETE في normal application role.**

## 11.2 outbox_events

| **الحقل**                     | **النوع**                  | **القاعدة**                          |
|-------------------------------|----------------------------|--------------------------------------|
| id                            | uuid PK                    | يفضل UUIDv7.                         |
| workspace_id                  | uuid NULL                  | System event قد يكون global.         |
| event_type                    | text NOT NULL              | SessionCompleted/PaymentPosted/...   |
| aggregate_type / aggregate_id | text/uuid NOT NULL         | —                                    |
| payload                       | jsonb NOT NULL             | Versioned safe event payload.        |
| status                        | text NOT NULL              | PENDING/PROCESSING/PROCESSED/FAILED. |
| occurred_at / available_at    | timestamptz NOT NULL       | —                                    |
| attempt_count                 | integer NOT NULL DEFAULT 0 | —                                    |
| processed_at                  | timestamptz NULL           | —                                    |
| last_error                    | text NULL                  | Sanitized.                           |
| created_at                    | timestamptz NOT NULL       | —                                    |

## 11.3 idempotency_records

| **الحقل**                            | **النوع**     | **القاعدة**                                                     |
|--------------------------------------|---------------|-----------------------------------------------------------------|
| id                                   | uuid PK       | —                                                               |
| workspace_id                         | uuid NOT NULL | —                                                               |
| operation                            | text NOT NULL | CREATE_MONTH/RECORD_PAYMENT/COMPLETE_SESSION/BILLING_WEBHOOK... |
| key                                  | text NOT NULL | Client/provider idempotency key.                                |
| request_hash                         | text NOT NULL | نفس key لا يقبل payload مختلف.                                  |
| status                               | text NOT NULL | IN_PROGRESS/COMPLETED/FAILED_RETRYABLE وفق implementation.      |
| response_code                        | integer NULL  | —                                                               |
| response_payload                     | jsonb NULL    | Safe response snapshot عند الحاجة.                              |
| created_at / updated_at / expires_at | timestamptz   | Retention حسب العملية.                                          |

**UNIQUE(workspace_id, operation, key).**

# 12. القيود الحرجة — Integrity Contract

| **ID** | **القاعدة التي يجب أن تمنعها DB/Application**                                   |
|--------|---------------------------------------------------------------------------------|
| INT-01 | Workspace لا يمتلك أكثر من OperatingMonth واحدة CURRENT.                        |
| INT-02 | Group ثابتة عبر الشهور؛ GroupMonth واحدة فقط لكل (group, operating_month).      |
| INT-03 | Student لا يمتلك Primary Guardian أكثر من واحد.                                 |
| INT-04 | Student لا يمتلك QRCredential ACTIVE أكثر من واحدة.                             |
| INT-05 | Student لا يمتلك AttentionCase نشطة أكثر من واحدة.                              |
| INT-06 | Session rescheduled لها Replacement واحدة فقط؛ الأصل يبقى محفوظًا ولا يعد مرتين. |
| INT-07 | SessionRecord لا يمكن أن تربط Session وEnrollment من GroupMonth مختلفتين.       |
| INT-08 | Enrollment واحدة فقط لكل Student/GroupMonth.                                    |
| INT-09 | Exam absence لا تُخزن كدرجة صفر؛ score موجود فقط عند SCORED.                     |
| INT-10 | FinancialObligation واحدة لكل Enrollment في Teacher V1.                         |
| INT-11 | Payment amount \>0 ولا يتجاوز remaining؛ overpayment غير مدعوم.                 |
| INT-12 | Payment idempotency يمنع duplicate transaction.                                 |
| INT-13 | Discount + Waiver لا يتجاوز Base Fee، وكل cached financial aggregates متسقة.    |
| INT-14 | Operational/financial history لا Hard Delete في normal flow.                    |
| INT-15 | Unauthorized/out-of-scope access لا يكشف وجود entity.                           |

# 13. Index Strategy

لا يتم إنشاء Index لكل column. الـIndexes أدناه مرتبطة بالـqueries الحرجة، وتراجع بالـEXPLAIN/metrics بعد تشغيل حقيقي.

| **Table**             | **Index / Purpose**                                                                        |
|-----------------------|--------------------------------------------------------------------------------------------|
| memberships           | (user_id, status) لتحميل Workspaces المسموحة.                                              |
| groups                | (workspace_id, status).                                                                    |
| group_months          | (workspace_id, operating_month_id) + UNIQUE(group_id, operating_month_id).                 |
| sessions              | (workspace_id, group_month_id, scheduled_at) و(workspace_id, status, scheduled_at).        |
| students              | UNIQUE(workspace_id, student_code) + GIN pg_trgm(search_name_normalized).                  |
| guardians             | (workspace_id, normalized_phone).                                                          |
| enrollments           | (workspace_id, group_month_id, status) و(student_id, group_month_id) unique.               |
| session_records       | (workspace_id, session_id) و(workspace_id, enrollment_id).                                 |
| financial_obligations | (workspace_id, status, due_date) و(workspace_id, due_date).                                |
| payments              | (workspace_id, obligation_id, paid_at DESC).                                               |
| attention_cases       | (workspace_id, status, priority) + partial active unique.                                  |
| attention_evidence    | (attention_reason_id, observed_at DESC).                                                   |
| scheduled_followups   | (workspace_id, status, due_at).                                                            |
| notifications         | (user_id, read_at, created_at DESC).                                                       |
| audit_events          | (workspace_id, created_at DESC) + (workspace_id, entity_type, entity_id, created_at DESC). |
| outbox_events         | Partial (status, available_at) WHERE status IN ('PENDING','FAILED').                       |

## 13.1 Arabic Search Normalization

- أ/إ/آ → ا

- ى → ي

- حذف التشكيل والتطويل

- توحيد المسافات

- توحيد الأرقام العربية/الغربية للبحث عند الحاجة

- البحث باسم الطالب/Student ID/normalized guardian phone/QR exact

**كل النتائج تُفلتر بالـWorkspace والـPermission/Scope قبل response. Unauthorized/out-of-scope يعيد نفس safe no-result behavior.**

# 14. Hot Tables وPartitioning Readiness

الجداول المرشحة للنمو الكبير: session_records، audit_events، outbox_events، notifications، contact_logs، payments. لا Partitioning في V1 افتراضيًا. يُفعّل لاحقًا بناءً على row count، index size، query latency، vacuum pressure وEXPLAIN metrics. Time-based partitioning مرشح أولي، مع إمكانية workspace hash عند الحاجة فقط.

# 15. ON DELETE / Historical Integrity

| **العلاقة**                              | **Policy**                        | **السبب**                                    |
|------------------------------------------|-----------------------------------|----------------------------------------------|
| Workspace → operational data             | RESTRICT                          | لا انهيار Tenant history بسبب حذف.           |
| User → Membership                        | RESTRICT                          | Actor history.                               |
| Group → GroupMonth                       | RESTRICT                          | تاريخ الشهور.                                |
| OperatingMonth → GroupMonth              | RESTRICT                          | —                                            |
| GroupMonth → Sessions/Enrollments        | RESTRICT                          | تاريخ تشغيل.                                 |
| Student → Enrollment                     | RESTRICT                          | تاريخ طالب.                                  |
| Student/Guardian → StudentGuardian       | RESTRICT في normal flow           | Archive بدل delete.                          |
| Session → SessionRecord                  | RESTRICT                          | سجل الحصة.                                   |
| Enrollment → SessionRecord/Obligation    | RESTRICT                          | سلامة تشغيل ومال.                            |
| Obligation → Payment                     | RESTRICT                          | Ledger immutable.                            |
| Payment → Reversal                       | RESTRICT                          | —                                            |
| AttentionCase → Reason/Evidence          | RESTRICT                          | Evidence history.                            |
| ContactLog optional Session/Case context | SET NULL فقط إذا بقي السجل مفهومًا | الحفاظ على log مع إزالة reference غير ضروري. |
| Audit entity reference                   | No physical FK required           | يجب أن يبقى audit حتى لو archived.           |
| Outbox aggregate reference               | No physical FK required           | event history/dispatch independence.         |

# 16. RLS & Tenant Isolation Strategy

**القرار: Application Authorization + PostgreSQL RLS Defense-in-Depth.**

- Frontend لا يستخدم service_role ولا يصل مباشرة إلى Business tables في core workflows.

- Browser → NestJS API → authentication → active membership → permission → group scope → repository/database.

- Application API DB role يعمل تحت RLS. Migration/Admin role منفصلة وذات وصول privileged محكوم.

- عند بدء transaction يضع الـBackend سياقًا مثل app.user_id وapp.workspace_id (أو آلية PostgreSQL/connection equivalent آمنة) وتستخدم RLS للتأكد أن workspace_id للسجل يطابق السياق.

- RLS مسؤولة أساسًا عن Tenant boundary؛ Permission/Group Scope المنطقية تبقى في Backend لتجنب سياسات RLS شديدة التعقيد وصعبة الاختبار.

- كل query يجب أن تكون tenant-safe حتى قبل RLS؛ RLS ليست مبررًا لكتابة repository queries غير مقيدة.

> -- Conceptual only; exact implementation is an ADR/implementation detail  
> SET LOCAL app.user_id = '\<authenticated-user-uuid\>';  
> SET LOCAL app.workspace_id = '\<authorized-workspace-uuid\>';  
>   
> -- Tenant policy concept  
> USING (workspace_id = current_setting('app.workspace_id')::uuid)

# 17. Transaction Boundaries

## 17.1 RecordPayment

> BEGIN  
> 1. Validate membership + payments.record + scope + entitlement.  
> 2. Acquire/validate idempotency record.  
> 3. SELECT obligation FOR UPDATE.  
> 4. Validate amount \> 0 and amount \<= remaining.  
> 5. INSERT payment (POSTED).  
> 6. Recalculate cached paid/remaining/status on obligation.  
> 7. INSERT AuditEvent.  
> 8. INSERT OutboxEvent(PaymentPosted).  
> 9. Complete idempotency response.  
> COMMIT  
>   
> Any failure =\> ROLLBACK ALL.

## 17.2 CompleteSession

> BEGIN  
> 1. Validate entitlement + session permissions + group scope.  
> 2. Lock/check session version and state = IN_PROGRESS.  
> 3. Validate required SessionRecords according to complete-with-gaps flag.  
> 4. Persist final records/edits.  
> 5. Transition session to COMPLETED + completed_at.  
> 6. Insert required AuditEvents.  
> 7. Insert OutboxEvent(SessionCompleted).  
> 8. Complete idempotency record / transition guard.  
> COMMIT  
>   
> Attention/Reports/Notifications consume event asynchronously.

## 17.3 CreateMonth / Carry Forward

> BEGIN  
> 1. Validate Owner + active entitlement + idempotency key.  
> 2. Validate no duplicate (workspace, year, month).  
> 3. Create OperatingMonth.  
> 4. Create selected GroupMonths using same Group IDs.  
> 5. Create reviewed Enrollments.  
> 6. Calculate FinancialObligations using approved fee/proration rules.  
> 7. Generate actual Sessions from ScheduleRules + Workspace timezone.  
> 8. Insert AuditEvent + OutboxEvent(MonthCreated).  
> 9. Complete idempotency response.  
> COMMIT  
>   
> If any artifact generation fails, no partial month remains.

# 18. Financial Calculation Contract

**Mid-month proration:**

> prorated_due = base_fee × eligible_remaining_sessions ÷ total_actual_billable_sessions

- Money in minor units/fixed Decimal؛ final rounding half-up إلى أقرب قرش مرة واحدة في الناتج النهائي.

- Cancelled sessions مستبعدة. Reschedule يحل محل الأصل ويحسب مرة واحدة.

- Manual extra session غير داخلة في proration افتراضيًا إلا billable_for_proration=true قبل الحساب.

- إذا total_actual_billable_sessions=0 فخيار Remaining Sessions غير متاح.

- Join-date eligibility: session local datetime on/after join_date تعتبر eligible؛ same-day session eligible.

- Preview يحفظ calculation basis/snapshot بحيث يمكن تفسير obligation لاحقًا.

# 19. Event / Outbox / Idempotency Contract

| **Event**                     | **Aggregate**            | **Consumers المحتملون**                                            |
|-------------------------------|--------------------------|--------------------------------------------------------------------|
| MonthCreated                  | OperatingMonth           | Notifications/analytics/read-models.                               |
| SessionCompleted              | Session                  | Attention engine/report projections/action center/missing records. |
| PaymentPosted                 | Payment                  | Collection read models/analytics/audit-related flows.              |
| PaymentReversed               | Payment                  | Finance projection/analytics.                                      |
| StudentEnrolled               | Enrollment               | Roster/read models.                                                |
| AttentionCaseOpened/Updated   | AttentionCase            | Follow-up queue/notifications.                                     |
| SubscriptionActivated/Expired | Subscription/Entitlement | Access projections/notifications.                                  |

**Outbox payloads versioned ومحدودة ولا تحتوي secrets. Consumers يجب أن تكون idempotent وقابلة retry؛ BullMQ/Worker قد يعيد job أكثر من مرة.**

# 20. Drizzle Database Package Structure

> packages/database/  
> ├── src/  
> │ ├── schema/  
> │ │ ├── identity.ts  
> │ │ ├── workspaces.ts  
> │ │ ├── permissions.ts  
> │ │ ├── months.ts  
> │ │ ├── groups.ts  
> │ │ ├── students.ts  
> │ │ ├── guardians.ts  
> │ │ ├── sessions.ts  
> │ │ ├── finance.ts  
> │ │ ├── attention.ts  
> │ │ ├── followup.ts  
> │ │ ├── subscriptions.ts  
> │ │ ├── notifications.ts  
> │ │ ├── audit.ts  
> │ │ └── outbox.ts  
> │ ├── relations/  
> │ ├── repositories/  
> │ ├── migrations/  
> │ ├── seeds/  
> │ └── index.ts  
> ├── drizzle.config.ts  
> └── package.json

**لا ملف schema.ts واحد بآلاف الأسطر. Drizzle abstraction لا يمنع SQL صريح موثق ومختبر عندما نحتاج partial indexes أو RLS أو locking أو query tuning.**

# 21. Migration Plan — Forward Only

| **Migration**                        | **المحتوى**                                                     |
|--------------------------------------|-----------------------------------------------------------------|
| 0001_extensions_and_foundation       | PostgreSQL extensions اللازمة مثل pg_trgm + helpers.            |
| 0002_users_workspaces                | users, workspaces.                                              |
| 0003_memberships_permissions         | memberships, permission_grants, group scopes.                   |
| 0004_locations_months_groups         | locations, operating_months, groups.                            |
| 0005_group_month_schedule_sessions   | group_months, schedule_rules, sessions.                         |
| 0006_students_guardians              | students, guardians, student_guardians, QR.                     |
| 0007_enrollments                     | enrollments + integrity constraints.                            |
| 0008_session_records_exams           | session_exams, session_records + composite FKs.                 |
| 0009_financial_obligations           | obligations + checks.                                           |
| 0010_payments_reversals              | payments, reversals, idempotency constraints.                   |
| 0011_attention_engine                | cases, reasons, evidence.                                       |
| 0012_contact_followups               | contact_logs, scheduled_followups.                              |
| 0013_subscriptions_entitlements      | subscriptions, entitlements.                                    |
| 0014_invitations_notifications       | workspace invitations, notifications.                           |
| 0015_audit                           | audit_events + append-only privileges.                          |
| 0016_outbox_idempotency              | outbox_events, generic idempotency_records.                     |
| 0017_indexes                         | query-driven indexes + pg_trgm search index.                    |
| 0018_rls                             | tenant policies / roles / grants.                               |
| 0019_seed_permission_catalog         | Permission Catalog canonical seed.                              |
| 0020_seed_feature_flags_and_defaults | complete-with-gaps false, exam-drop disabled, product defaults. |

## 21.1 Zero/Low-Downtime Schema Evolution

**أي breaking schema change يتبع: Expand → Backfill/Migrate Data → Switch Code → Verify → Contract لاحقًا. لا DROP COLUMN في نفس release الذي يغير الكود المعتمد عليها. لا manual production schema edits؛ كل تغيير Migration داخل Git ومراجع في CI.**

# 22. Seed / Golden Dataset

- Owner Workspace + شهران تشغيليان.

- 3 مجموعات على الأقل مع GroupMonth متعددة.

- 20–50 طالبًا، منهم إخوة يشتركون في Guardian.

- Mid-month enrollment + withdrawn/transferred student.

- Completed/Cancelled/Rescheduled/Manual sessions.

- No homework + exam absent + scored exam cases.

- Partial payment + reversed payment + old debt من شهر سابق.

- AttentionCase واحدة بأسباب متعددة + deferred follow-up.

- Private Assistant + External Center Assistant scoped لمجموعة محددة.

- Expired subscription read-only scenario + active/trial scenario.

**الـSeed هدفه تشغيل Golden Flow وQA الحقيقي، لا مجرد Test User 1.**

# 23. Database Verification / Definition of Ready

| **Test**             | **Expected**                                                       |
|----------------------|--------------------------------------------------------------------|
| Tenant isolation     | User من Workspace A لا يقرأ/يعدل B حتى مع ID معروف.                |
| Group scope          | Assistant Group A لا يمكنه اكتشاف Student في Group B.              |
| Current month        | محاولة Current ثانية لنفس Workspace تفشل constraint.               |
| Mid-month roster     | Session قبل join_date لا تحتوي الطالب ولا تحسبه absent.            |
| Cross-group record   | DB ترفض SessionRecord إذا Session/Enrollment من GroupMonth مختلفة. |
| QR reissue           | لا يمكن وجود اثنين ACTIVE لنفس الطالب؛ القديم يصبح invalid.        |
| Primary guardian     | لا يمكن اثنين primary لنفس student.                                |
| Attention uniqueness | غياب+واجب ينتجان Case نشطة واحدة متعددة reasons.                   |
| Payment overage      | amount \> remaining تُرفض قبل insert.                               |
| Double payment       | نفس idempotency key يعيد نفس النتيجة دون row ثانية.                |
| Reversal             | Payment الأصلية تبقى + Reversal واحدة + obligation recalculated.   |
| Exam absent          | لا numeric zero مخزن.                                              |
| Reschedule           | الأصل محفوظ؛ replacement واحدة؛ proration/count مرة واحدة.         |
| Create month retry   | لا duplicate month/sessions/obligations.                           |
| Audit immutability   | Application role لا update/delete audit rows.                      |
| Outbox reliability   | Business write + outbox event commit معًا أو rollback معًا.          |

# 24. قواعد ممنوعة على Claude Code / Engineering

- ممنوع student.month_id أو تكرار Student لكل شهر.

- ممنوع Group جديدة لكل شهر بدل GroupMonth.

- ممنوع guardian_phone داخل Student كعلاقة رئيسية.

- ممنوع QR يحمل PII أو raw predictable identifiers.

- ممنوع float/double للأموال.

- ممنوع payment deletion أو silent edit.

- ممنوع arrays of relational IDs داخل JSON بدل relation tables.

- ممنوع Direct frontend access إلى core business tables أو service_role.

- ممنوع اعتبار Frontend permission checks حماية.

- ممنوع silent last-write-wins في sensitive records.

- ممنوع generic records table يجمع attendance/homework/finance بلا domain boundaries.

- ممنوع إضافة entity/relation/business behavior غير موثق في PRD/Architecture/هذه الوثيقة دون Change Request.

# 25. Scale Readiness

**هذا الـSchema ليس مصممًا على رقم 1000 مدرس فقط، بل على صحة الـDomain أولًا مع مسار Scale واضح: query tuning/indexes → read models/projections → larger PostgreSQL compute/read replicas → partition hot tables عند قياس الحاجة → search projection/OpenSearch عند الحاجة. لا يلزم تغيير المعنى الأساسي لـStudent/GroupMonth/Session/Finance عند هذه المراحل.**

# 26. حالة المرحلة والخطوة التالية

| **Database Definition: CLOSED —** Canonical ERD، العلاقات، Data Dictionary، Financial model، Critical Constraints، Index strategy، Delete strategy، RLS boundary، Transaction boundaries، Outbox/Idempotency، Drizzle structure، Migration plan وQA readiness أصبحت معتمدة لTeacher V1. أي تغيير جوهري بعد ذلك يتطلب Addendum/Change Request. |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

| **البند**              | **الحالة** |
|------------------------|------------|
| Canonical ERD          | APPROVED   |
| Data Dictionary        | APPROVED   |
| Critical Constraints   | APPROVED   |
| Money/Ledger Model     | APPROVED   |
| Index Strategy         | APPROVED   |
| Tenant/RLS Strategy    | APPROVED   |
| Transaction Boundaries | APPROVED   |
| Outbox/Idempotency     | APPROVED   |
| Drizzle/Migration Plan | APPROVED   |
| Database QA Contract   | APPROVED   |

**Next Step: API Contract v1.0 — تحويل كل Use Case إلى REST/OpenAPI endpoints وrequest/response schemas وpermissions/scopes/idempotency/error contracts دون إعادة اختراع الـDomain.**
