**Academic Precision**

**Teacher V1 — API Contract**

**v1.0 Approved — Stable Product API Boundary**

| **الغرض —** تحويل Product Rules وTechnical Architecture وDatabase Contract إلى عقد API ثابت وقابل للاختبار والتنفيذ بواسطة Claude Code دون تخمين في الصلاحيات أو الحالات أو الأموال أو المعاملات. الـAPI يعبر عن Business Operations وليس CRUD مباشر على الجداول. |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

| **الحقل**     | **القيمة**                                                          |
|---------------|---------------------------------------------------------------------|
| الإصدار       | 1.0 Approved                                                        |
| النطاق        | Academic Precision — Teacher V1 API                                 |
| النمط         | REST + OpenAPI 3.x                                                  |
| Base Path     | /api/v1                                                             |
| المستهدف      | Claude Code / Web / Future Mobile / QA / Integrations               |
| المصدر الأعلى | PRD V1.1 Final + Technical Architecture v1.0 + Database Schema v1.0 |
| حالة المرحلة  | API Definition CLOSED — Ready for Implementation Planning & Handoff |

## Source of Truth

**عند التعارض: PRD Business Rules → Canonical Product Model → Technical Architecture → Database Schema → API Contract → UI. لا يجوز للـAPI اختراع Business Rule أو Permission أو Financial Behavior أو Entity Relationship غير معرف في المراجع الأعلى.**

# 1. المبادئ الحاكمة للـAPI

- الـAPI هو Stable Product Boundary؛ لا يسمح للـFrontend بالوصول المباشر إلى Business tables في العمليات الأساسية.

- كل Action حساس يمر بالترتيب: Authentication → Workspace Membership → Permission → Group Scope → Entitlement → Business Rule → Persistence/Audit.

- الـAPI Command-oriented في العمليات ذات الحالة: start/complete/reschedule/reverse/withdraw؛ ولا يستخدم PATCH عام ليختصر Business Logic.

- OpenAPI هو العقد التنفيذي الرسمي للـRequests/Responses/Errors، وتولد منه Types/clients عند الإمكان.

- Database Model لا يساوي API Model؛ لا يتم كشف token_hash أو secrets أو provider metadata أو حقول خارج الصلاحية.

- كل الأموال في الـAPI integer minor units + ISO currency؛ لا float ولا strings مالية كمصدر حقيقة.

- العمليات الحساسة تستخدم Idempotency وOptimistic Concurrency حسب العقد، ولا silent last-write-wins.

- كل Collection كبيرة تستخدم Cursor Pagination، مع Filter/Sort whitelist صريح لكل Endpoint.

- الاستجابات لا تدعي حفظًا أو اكتمال projection قبل تأكيد الخادم/المعاملة.

- كل API قابل للتوسع أفقيًا Stateles؛ العمليات الثقيلة تستخدم Worker/Queue عند الحاجة دون تغيير Business semantics.

# 2. Transport & Protocol Contract

| **البند**         | **القرار**                                                                                |
|-------------------|-------------------------------------------------------------------------------------------|
| Base URL          | /api/v1                                                                                   |
| Protocol          | HTTPS only في Production                                                                  |
| Format            | application/json; charset=utf-8                                                           |
| API style         | REST resources + explicit domain commands                                                 |
| OpenAPI           | 3.x؛ شامل schemas, security, permissions, entitlements, errors, examples                  |
| Time              | ISO 8601 timestamps؛ UTC/offset accepted; Workspace timezone authority                    |
| Date              | YYYY-MM-DD                                                                                |
| Money             | amountMinor integer + currency ISO 4217                                                   |
| Request tracing   | X-Request-Id returned on every response                                                   |
| Workspace context | X-Workspace-Id when route does not already establish context; server validates membership |
| Idempotency       | Idempotency-Key required on defined critical commands                                     |
| Concurrency       | version / ETag semantics on sensitive updates                                             |

# 3. Success, Collection, and Error Shapes

## 3.1 Resource success

> {  
> "id": "uuid",  
> "...": "resource fields"  
> }

## 3.2 Cursor collection

> {  
> "items": \[ ... \],  
> "page": {  
> "nextCursor": "opaque-or-null",  
> "hasNext": true  
> }  
> }

## 3.3 Error contract

> {  
> "error": {  
> "code": "PAYMENT_EXCEEDS_REMAINING",  
> "message": "المبلغ يتجاوز المتبقي.",  
> "details": {}  
> },  
> "requestId": "req\_..."  
> }

| **قاعدة —** الـFrontend يعتمد على error.code للـlogic وليس على نص message. الرسالة عربية قابلة للتحسين دون كسر الـContract. |
|-----------------------------------------------------------------------------------------------------------------------------|

# 4. HTTP Status Semantics

| **Status**               | **الاستخدام**                                                               |
|--------------------------|-----------------------------------------------------------------------------|
| 200 OK                   | قراءة أو Command ناجح يرجع Body.                                            |
| 201 Created              | إنشاء Resource جديد.                                                        |
| 202 Accepted             | Job طويل تم قبوله ولم يكتمل بعد.                                            |
| 204 No Content           | Action ناجح لا يحتاج Body.                                                  |
| 400 Bad Request          | صيغة request غير صحيحة/بارامترات malformed.                                 |
| 401 Unauthorized         | لا توجد هوية مصادق عليها/Session غير صالحة.                                 |
| 403 Forbidden            | المستخدم معروف لكن غير مسموح بالفعل عندما كشف وجود المورد ليس حساسًا.        |
| 404 Not Found            | مورد غير موجود أو safe no-leak خارج scope عند الحاجة.                       |
| 409 Conflict             | Version/state/idempotency conflict.                                         |
| 422 Unprocessable Entity | Business validation مفهومة لكن غير مسموحة، مثل overpayment/missing records. |
| 429 Too Many Requests    | Rate limit.                                                                 |
| 500                      | Unexpected server failure؛ requestId إلزامي.                                |

# 5. Authentication, Workspace, Authorization

**Supabase Auth يثبت Identity فقط. الـBackend يربطها بـusers/memberships ويطبق Product Authorization. لا ترسل الواجهة user_id أو membership_id كAuthority.**

> Authenticated Identity  
> ↓  
> resolve User  
> ↓  
> resolve Workspace Membership  
> ↓  
> Permission  
> ↓  
> Group Scope  
> ↓  
> Entitlement  
> ↓  
> Business Rule / Resource

## 5.1 Workspace context

الـWeb يرسل X-Workspace-Id عندما يحتاج المستخدم الاختيار بين أكثر من Workspace. الـBackend يرفض أي Workspace لا توجد له Membership نشطة. لا تعتبر قيمة Header تصريحًا بحد ذاتها.

## 5.2 Safe no-leak

عند بحث Assistant عن Student خارج Group Scope، أو QR يعود لـWorkspace/Group أخرى، يعاد نفس Safe no-result/404 ولا يتم تأكيد وجود الطالب أو Workspace الأخرى.

# 6. Pagination, Filtering, Sorting

| **العنصر**    | **العقد**                                                                                |
|---------------|------------------------------------------------------------------------------------------|
| Pagination    | cursor + limit؛ default 50، max configurable per endpoint.                               |
| Cursor        | Opaque؛ لا يعتمد العميل على محتواه.                                                      |
| Filter        | Whitelist معلنة لكل endpoint؛ لا Generic query DSL.                                      |
| Sort          | sort=field:asc\|desc من whitelist فقط.                                                   |
| Large exports | لا تستخدم pagination العادية؛ Export Job عند الحاجة.                                     |
| Search        | normalized Arabic/name/Student ID/phone/QR حسب endpoint مع scope filtering قبل response. |

# 7. Idempotency Contract

Idempotency-Key إلزامي للـCreate Month وRecord Payment وReverse Payment وComplete Session ومعالجة Billing Webhooks. يمكن إضافته لأوامر حساسة أخرى بدون تغيير المعنى.

> Idempotency-Key: 8f0a...  
> Operation: payment.create  
> Request-Hash: sha256(canonical-request)

- نفس Key + نفس operation + نفس payload → يرجع نفس النتيجة الأصلية ولا ينفذ side effects مرة ثانية.

- نفس Key + payload مختلف → 409 IDEMPOTENCY_CONFLICT.

- الـkey scoped by workspace + operation حيث ينطبق.

- الـresponse المعاد لا يعيد تشغيل rule engine أو ledger/outbox effects.

# 8. Optimistic Concurrency

كل تعديل حساس يرسل version الحالي. إذا تغير السجل منذ قراءته، يعاد 409 VERSION_CONFLICT مع أحدث metadata الآمنة اللازمة لإعادة التحميل، ولا يحدث silent overwrite.

> PATCH /api/v1/group-months/{id}  
> {  
> "version": 7,  
> "locationId": "..."  
> }  
>   
> → 409 VERSION_CONFLICT if DB version = 8

# 9. Endpoint Registry — العقد الرسمي

الجدول التالي هو Registry تنفيذي. Permission/Entitlement المذكوران حد أدنى؛ قد توجد Preconditions/State rules إضافية موثقة في الأقسام التفصيلية.

## 9.1 Identity / Me / Onboarding

| **Method** | **Path**                    | **Permission**    | **Entitlement** | **Purpose**                                                |
|------------|-----------------------------|-------------------|-----------------|------------------------------------------------------------|
| GET        | /me                         | Authenticated     | —               | User + available workspaces                                |
| GET        | /me/workspaces/{id}/context | Active membership | —               | Effective membership/permissions/entitlements/subscription |
| POST       | /onboarding/complete        | Owner             | —               | Complete owner onboarding; no month auto-create            |

## 9.2 Months

| **Method** | **Path**        | **Permission** | **Entitlement** | **Purpose**                                    |
|------------|-----------------|----------------|-----------------|------------------------------------------------|
| GET        | /months         | Scoped read    | Historical read | List current/history                           |
| GET        | /months/{id}    | Scoped read    | Historical read | Month details                                  |
| POST       | /months/preview | Owner          | CREATE_MONTH    | Carry-forward preview + previewToken           |
| POST       | /months         | Owner          | CREATE_MONTH    | Create month transaction; Idempotency required |

## 9.3 Groups / GroupMonth / Schedule

| **Method** | **Path**                            | **Permission**  | **Entitlement**      | **Purpose**                               |
|------------|-------------------------------------|-----------------|----------------------|-------------------------------------------|
| GET        | /groups                             | groups.view     | Historical/Core read | Scoped groups                             |
| POST       | /groups                             | groups.manage   | CORE_OPERATIONS      | Create stable Group                       |
| GET        | /groups/{id}                        | groups.view     | Core/Historical read | Group details                             |
| PATCH      | /groups/{id}                        | groups.manage   | CORE_OPERATIONS      | Edit stable identity; versioned           |
| GET        | /group-months/{id}                  | groups.view     | Core/Historical read | Monthly config                            |
| POST       | /group-months/{id}/change-preview   | groups.manage   | CORE_OPERATIONS      | Impact preview                            |
| POST       | /group-months/{id}/apply-change     | groups.manage   | CORE_OPERATIONS      | Apply approved strategy; audit/idempotent |
| GET        | /group-months/{id}/schedule         | groups.view     | Core/Historical read | Schedule rules                            |
| POST       | /group-months/{id}/schedule/preview | sessions.manage | CORE_OPERATIONS      | Future session impact                     |
| POST       | /group-months/{id}/schedule/apply   | sessions.manage | CORE_OPERATIONS      | Apply preview token/version               |

## 9.4 Sessions

| **Method** | **Path**                                   | **Permission**                              | **Entitlement**      | **Purpose**                         |
|------------|--------------------------------------------|---------------------------------------------|----------------------|-------------------------------------|
| GET        | /sessions                                  | sessions.read/groups.view                   | Core/Historical read | Filtered sessions                   |
| GET        | /sessions/{id}                             | Scoped read                                 | Core/Historical read | Session detail                      |
| POST       | /sessions/{id}/start                       | attendance.write or authorized session role | CORE_OPERATIONS      | SCHEDULED→IN_PROGRESS               |
| POST       | /sessions/{id}/cancel                      | sessions.manage                             | CORE_OPERATIONS      | Cancel eligible session             |
| POST       | /sessions/{id}/reschedule-preview          | sessions.manage                             | CORE_OPERATIONS      | Preview replacement                 |
| POST       | /sessions/{id}/reschedule                  | sessions.manage                             | CORE_OPERATIONS      | Create one linked replacement       |
| GET        | /sessions/{id}/roster                      | students.view_basic + session scope         | CORE_OPERATIONS      | Eligible enrollments only           |
| PUT        | /sessions/{id}/attendance                  | attendance.write                            | CORE_OPERATIONS      | Atomic batch attendance             |
| POST       | /sessions/{id}/attendance/mark-all-present | attendance.write                            | CORE_OPERATIONS      | Bulk command                        |
| PUT        | /sessions/{id}/homework                    | homework.write                              | CORE_OPERATIONS      | Atomic batch homework               |
| POST       | /sessions/{id}/homework/mark-all-done      | homework.write                              | CORE_OPERATIONS      | Bulk command                        |
| POST       | /sessions/{id}/homework/no-homework        | homework.write                              | CORE_OPERATIONS      | Resolved no-homework state          |
| PUT        | /sessions/{id}/exam                        | exams.write                                 | CORE_OPERATIONS      | Define optional exam                |
| PUT        | /sessions/{id}/exam/scores                 | exams.write                                 | CORE_OPERATIONS      | Atomic batch scores/absence         |
| GET        | /sessions/{id}/review                      | Scoped session read                         | CORE_OPERATIONS      | Server-computed canComplete/missing |
| POST       | /sessions/{id}/complete                    | Authorized session writes                   | CORE_OPERATIONS      | Idempotent completion transaction   |

## 9.5 Students / Guardians / Enrollment / QR

| **Method** | **Path**                                                 | **Permission**      | **Entitlement**      | **Purpose**                                             |
|------------|----------------------------------------------------------|---------------------|----------------------|---------------------------------------------------------|
| GET        | /students                                                | students.view_basic | Core/Historical read | Scoped directory/search                                 |
| POST       | /students/match-preview                                  | students.edit       | CORE_OPERATIONS      | Possible duplicates; no auto merge                      |
| POST       | /students                                                | students.edit       | CORE_OPERATIONS      | Create Student + guardian links + initial QR as defined |
| GET        | /students/{id}                                           | students.view_basic | Core/Historical read | Student 360 projection                                  |
| PATCH      | /students/{id}                                           | students.edit       | CORE_OPERATIONS      | Versioned basic edit                                    |
| POST       | /students/{id}/archive                                   | students.edit       | CORE_OPERATIONS      | Archive; no hard delete                                 |
| POST       | /students/{id}/guardians                                 | students.edit       | CORE_OPERATIONS      | Link/create enabled guardian                            |
| PATCH      | /students/{studentId}/guardians/{guardianId}             | students.edit       | CORE_OPERATIONS      | Edit relation/contact flags                             |
| POST       | /students/{studentId}/guardians/{guardianId}/set-primary | students.edit       | CORE_OPERATIONS      | Set one primary                                         |
| POST       | /group-months/{id}/enrollments/preview                   | students.edit       | CORE_OPERATIONS      | Proration/full/custom preview                           |
| POST       | /group-months/{id}/enrollments                           | students.edit       | CORE_OPERATIONS      | Enrollment + obligation transaction                     |
| POST       | /enrollments/{id}/withdraw                               | students.edit       | CORE_OPERATIONS      | Withdraw with effective reason/date                     |
| POST       | /enrollments/{id}/transfer-preview                       | students.edit       | CORE_OPERATIONS      | Transfer impact preview                                 |
| POST       | /enrollments/{id}/transfer                               | students.edit       | CORE_OPERATIONS      | Transfer preserving Student identity                    |
| POST       | /students/{id}/qr/issue                                  | students.edit       | CORE_OPERATIONS      | Issue if no active QR                                   |
| POST       | /students/{id}/qr/reissue                                | students.edit       | CORE_OPERATIONS      | Revoke old; audit; token once                           |
| POST       | /qr/resolve                                              | Context permission  | Core/Historical read | GLOBAL/SESSION/PAYMENT context-safe resolve             |

## 9.6 Finance / Payments

| **Method** | **Path**                   | **Permission**                                   | **Entitlement**      | **Purpose**                            |
|------------|----------------------------|--------------------------------------------------|----------------------|----------------------------------------|
| GET        | /finance/summary           | finance.overview                                 | Core/Historical read | Workspace/group scoped summary         |
| GET        | /finance/collection-queue  | payments.view_student_status or finance.overview | Core/Historical read | Due/remaining queue                    |
| GET        | /students/{id}/obligations | payments.view_student_status                     | Core/Historical read | Month-separated obligations            |
| POST       | /payments                  | payments.record                                  | CORE_OPERATIONS      | Post one payment; Idempotency required |
| POST       | /payments/{id}/reverse     | payments.record + authorized correction          | CORE_OPERATIONS      | Reverse with mandatory reason          |

## 9.7 Attention / Follow-up

| **Method** | **Path**                              | **Permission**                | **Entitlement**      | **Purpose**                                        |
|------------|---------------------------------------|-------------------------------|----------------------|----------------------------------------------------|
| GET        | /attention-cases                      | followup.read                 | Core/Historical read | Unified active/history cases                       |
| GET        | /attention-cases/{id}                 | followup.read                 | Core/Historical read | Reasons/evidence/contact timeline                  |
| POST       | /attention-cases/{id}/start-followup  | followup.write                | CORE_OPERATIONS      | New→In Follow-up                                   |
| POST       | /attention-cases/{id}/mark-monitoring | followup.write                | CORE_OPERATIONS      | Monitoring state                                   |
| POST       | /attention-cases/{id}/close           | followup.write                | CORE_OPERATIONS      | Close explicitly                                   |
| GET        | /followups                            | followup.read                 | Core/Historical read | Scheduled queue                                    |
| POST       | /attention-cases/{id}/contact-draft   | parent_contact                | CORE_OPERATIONS      | Editable WhatsApp draft                            |
| POST       | /contact-logs                         | parent_contact/followup.write | CORE_OPERATIONS      | Persist selected guardian + outcome + optional due |
| POST       | /followups/{id}/complete              | followup.write                | CORE_OPERATIONS      | Complete scheduled follow-up                       |
| POST       | /followups/{id}/reschedule            | followup.write                | CORE_OPERATIONS      | Move due date/time                                 |

## 9.8 Team / Permissions

| **Method** | **Path**                         | **Permission**                  | **Entitlement** | **Purpose**                                  |
|------------|----------------------------------|---------------------------------|-----------------|----------------------------------------------|
| GET        | /team                            | team.manage or scoped team read | Core read       | Members/invitations safe view                |
| POST       | /team/invitations                | team.manage                     | TEAM_MANAGEMENT | Invite assistant with proposed grants/scopes |
| POST       | /team/invitations/{token}/accept | Invite token + auth             | —               | Create/activate membership once              |
| PATCH      | /memberships/{id}/permissions    | team.manage                     | TEAM_MANAGEMENT | Versioned grants/scopes + audit              |
| POST       | /memberships/{id}/disable        | team.manage                     | TEAM_MANAGEMENT | Disable without deleting history             |

## 9.9 Billing / Entitlements

| **Method** | **Path**              | **Permission**            | **Entitlement**   | **Purpose**                        |
|------------|-----------------------|---------------------------|-------------------|------------------------------------|
| GET        | /billing/subscription | Owner                     | Billing available | Current commercial state           |
| POST       | /billing/checkout     | Owner                     | Billing available | Create Paddle checkout/ref         |
| POST       | /billing/portal       | Owner                     | Billing available | Provider portal when supported     |
| POST       | /webhooks/paddle      | Signature verified public | —                 | Idempotent source-of-truth webhook |
| GET        | /entitlements         | Active membership         | —                 | Effective workspace capabilities   |

## 9.10 Reports / Notifications / Action Center

| **Method** | **Path**                   | **Permission**                      | **Entitlement**      | **Purpose**                            |
|------------|----------------------------|-------------------------------------|----------------------|----------------------------------------|
| GET        | /reports/student/{id}      | reports.view                        | Historical/Core read | Student report                         |
| GET        | /reports/group/{id}        | reports.view                        | Historical/Core read | Group report                           |
| GET        | /reports/monthly/{monthId} | reports.view                        | Historical/Core read | Monthly teacher report                 |
| POST       | /reports/export            | reports.export                      | REPORT_EXPORT        | CSV only in V1                         |
| GET        | /exports/{id}              | reports.export                      | REPORT_EXPORT        | Async export status/signed URL         |
| GET        | /notifications             | Authenticated                       | —                    | In-app notifications                   |
| POST       | /notifications/{id}/read   | Authenticated owner of notification | —                    | Mark read                              |
| POST       | /notifications/read-all    | Authenticated                       | —                    | Mark workspace/user notifications read |
| GET        | /action-center             | Scoped read                         | Core/Historical read | Aggregated operational read model      |

# 10. Permission + Entitlement Enforcement Matrix

Entitlement يقرر هل الـWorkspace يملك capability. Permission/Scope يقرران هل المستخدم الحالي يستطيع تنفيذها داخل الموارد المسموحة. الشرطان مستقلان ومطلوبان حيث يذكران.

| **العملية**         | **Permission**               | **Scope**                                                      | **Entitlement**      | **Audit**                           |
|---------------------|------------------------------|----------------------------------------------------------------|----------------------|-------------------------------------|
| Create month        | Owner                        | Workspace                                                      | CREATE_MONTH         | Yes                                 |
| Create/edit group   | groups.manage                | All/Selected حسب policy؛ create Owner/private assistant policy | CORE_OPERATIONS      | Changes yes                         |
| Start/attendance    | attendance.write             | Group                                                          | CORE_OPERATIONS      | Sensitive post-completion edits yes |
| Homework            | homework.write               | Group                                                          | CORE_OPERATIONS      | As configured                       |
| Exam                | exams.write                  | Group                                                          | CORE_OPERATIONS      | Post-completion edit yes            |
| Student view        | students.view_basic          | Group                                                          | Read capability      | No ordinary read                    |
| Student edit/enroll | students.edit                | Group                                                          | CORE_OPERATIONS      | Withdraw/transfer yes               |
| Payment status      | payments.view_student_status | Group                                                          | Read capability      | No ordinary read                    |
| Record payment      | payments.record              | Group                                                          | CORE_OPERATIONS      | Yes                                 |
| Finance overview    | finance.overview             | Allowed scope                                                  | Read capability      | No ordinary read                    |
| Parent contact      | parent_contact               | Group + enabled guardian                                       | CORE_OPERATIONS      | ContactLog itself                   |
| Follow-up write     | followup.write               | Scoped cases                                                   | CORE_OPERATIONS      | State/action log                    |
| Reports view        | reports.view                 | Group/month                                                    | Historical/Core read | No                                  |
| CSV export          | reports.export               | Group/month                                                    | REPORT_EXPORT        | Yes                                 |
| Team permissions    | team.manage                  | Workspace                                                      | TEAM_MANAGEMENT      | Yes                                 |
| QR reissue          | students.edit                | Student group scope                                            | CORE_OPERATIONS      | Yes                                 |

| **قاعدة —** payments.record لا يمنح finance.overview. write permissions imply corresponding read فقط كما هو محدد في Permission Catalog. الـBackend يعيد التحقق من dependencies عند grant time وعند request time. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 11. Critical Request/Response Schemas

## 11.1 GET /me

> {  
> "user": {"id":"uuid","fullName":"..."},  
> "workspaces": \[  
> {"id":"uuid","name":"...","roleLabel":"OWNER","status":"ACTIVE"}  
> \]  
> }

## 11.2 Workspace context

> {  
> "workspace": {"id":"uuid","name":"...","timezone":"Africa/Cairo"},  
> "membership": {"id":"uuid","roleLabel":"OWNER"},  
> "permissions": \["students.view_basic","attendance.write"\],  
> "entitlements": \["CORE_OPERATIONS","CREATE_MONTH"\],  
> "subscriptionState": "ACTIVE"  
> }

## 11.3 Create Month Preview

> POST /months/preview  
> {  
> "targetYear": 2026,  
> "targetMonth": 9,  
> "sourceMonthId": "uuid",  
> "selectedGroupIds": \["uuid"\]  
> }  
>   
> 200  
> {  
> "previewToken": "opaque",  
> "groups": \[...\],  
> "students": {"continuing":120,"excluded":3,"transferred":2},  
> "generatedSessions":32,  
> "newObligationsTotalMinor":7200000,  
> "studentsWithOldDebt":14,  
> "expiresAt":"..."  
> }

## 11.4 Create Month Confirm

> POST /months  
> Idempotency-Key: \<uuid\>  
> {  
> "previewToken":"opaque"  
> }  
>   
> 201  
> {  
> "monthId":"uuid",  
> "status":"CURRENT",  
> "groupMonthCount":4,  
> "sessionCount":32,  
> "enrollmentCount":120  
> }

الـserver يعيد validation للـpreview token، entitlement، versions والـsource state داخل transaction. Preview ليس Authorization.

## 11.5 Session Roster

> GET /sessions/{id}/roster  
> {  
> "session":{"id":"uuid","status":"IN_PROGRESS","version":3},  
> "students":\[  
> {  
> "enrollmentId":"uuid",  
> "studentId":"uuid",  
> "studentName":"...",  
> "studentCode":"AP-0001",  
> "record":{"attendance":null,"homework":null,"examStatus":"NO_EXAM","examScore":null},  
> "version":1  
> }  
> \]  
> }

## 11.6 Attendance Batch

> PUT /sessions/{id}/attendance  
> {  
> "sessionVersion":3,  
> "records":\[  
> {"enrollmentId":"uuid","status":"PRESENT"},  
> {"enrollmentId":"uuid","status":"ABSENT"}  
> \]  
> }  
>   
> 200  
> {  
> "sessionVersion":4,  
> "updated":2,  
> "summary":{"present":1,"absent":1,"late":0,"missing":18}  
> }

Batch Atomic في V1: إذا فشل صف بسبب eligibility/scope/state، يفشل الـbatch كاملًا ويرجع BATCH_VALIDATION_FAILED مع row details؛ لا partial write صامت.

## 11.7 Exam Definition & Scores

> PUT /sessions/{id}/exam  
> {  
> "hasExam":true,  
> "name":"اختبار الوحدة",  
> "maxScore":20,  
> "lowScoreThreshold":10,  
> "version":2  
> }  
>   
> PUT /sessions/{id}/exam/scores  
> {  
> "records":\[  
> {"enrollmentId":"uuid","status":"SCORED","score":17},  
> {"enrollmentId":"uuid","status":"ABSENT_FROM_EXAM"}  
> \]  
> }

| **قاعدة —** ABSENT_FROM_EXAM لا يخزن numeric zero ولا يدخل low-score rule كأنه 0. إذا exam.low threshold غير مهيأ فالRule معطلة، وexam_drop_rule disabled افتراضيًا. |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 11.8 Session Review / Complete

> GET /sessions/{id}/review  
> {  
> "attendanceSummary": {...},  
> "homeworkSummary": {...},  
> "examSummary": {...},  
> "missingRecords": \[...\],  
> "canComplete": false,  
> "blockingReasons":\["REQUIRED_RECORDS_MISSING"\]  
> }  
>   
> POST /sessions/{id}/complete  
> Idempotency-Key: \<uuid\>  
> {"version":5}  
>   
> 200  
> {  
> "session":{"id":"uuid","status":"COMPLETED","version":6},  
> "projectionStatus":"PENDING",  
> "followUpCandidates":\[...\]  
> }

إذا complete_session_with_missing_records=False وأي Required record ناقص → 422 SESSION_RECORDS_MISSING. No homework وAbsent from exam حالات resolved وليست missing.

## 11.9 Create Student

> POST /students  
> {  
> "name":"أحمد محمد",  
> "guardians":\[  
> {  
> "name":"محمد",  
> "phone":"+2010...",  
> "relationship":"FATHER",  
> "isPrimary":true,  
> "academicContactEnabled":true,  
> "financialContactEnabled":true  
> }  
> \]  
> }  
>   
> 201  
> {  
> "student":{"id":"uuid","studentCode":"AP-...","name":"أحمد محمد"},  
> "guardians":\[...\],  
> "qr":{"credentialId":"uuid","displayToken":"one-time-token-or-render-ref"}  
> }

قبل الإنشاء يمكن /students/match-preview. لا merge تلقائي حسب normalized phone/name. Raw QR token لا يعاد كشفه من DB بعد الإصدار.

## 11.10 Enrollment Preview / Create

> POST /group-months/{id}/enrollments/preview  
> {  
> "studentId":"uuid",  
> "joinDate":"2026-08-15",  
> "feeMethod":"REMAINING_SESSIONS"  
> }  
>   
> 200  
> {  
> "baseFeeMinor":60000,  
> "eligibleSessions":3,  
> "totalBillableSessions":8,  
> "calculatedDueMinor":22500,  
> "currency":"EGP",  
> "formula":"REMAINING_SESSIONS",  
> "rounding":"HALF_UP_FINAL_MINOR_UNIT",  
> "previewToken":"opaque"  
> }
>
> POST /group-months/{id}/enrollments  
> {  
> "studentId":"uuid",  
> "joinDate":"2026-08-15",  
> "feeMethod":"REMAINING_SESSIONS",  
> "previewToken":"opaque"  
> }  
>   
> 201  
> {  
> "enrollment": {...},  
> "obligation":{"netDueMinor":22500,"remainingMinor":22500,"status":"UNPAID"}  
> }

## 11.11 Record Payment

> POST /payments  
> Idempotency-Key: \<uuid\>  
> {  
> "obligationId":"uuid",  
> "amountMinor":20000,  
> "currency":"EGP",  
> "method":"CASH",  
> "paidAt":"2026-08-22T12:00:00+03:00",  
> "note":null  
> }  
>   
> 201  
> {  
> "payment":{"id":"uuid","status":"POSTED","amountMinor":20000},  
> "obligation":{"status":"PARTIAL","paidMinor":20000,"remainingMinor":30000}  
> }

## 11.12 Reverse Payment

> POST /payments/{id}/reverse  
> Idempotency-Key: \<uuid\>  
> {  
> "reason":"تم تسجيل المبلغ بالخطأ"  
> }  
>   
> 200  
> {  
> "payment":{"id":"uuid","status":"REVERSED"},  
> "reversal":{"id":"uuid","reason":"..."},  
> "obligation":{"status":"UNPAID","remainingMinor":50000}  
> }

| **Financial invariant —** لا DELETE ولا تعديل amount لدفعة Posted. Record/Reverse داخل transaction مع lock للـObligation، Idempotency، Audit، Outbox. Overpayment → 422 PAYMENT_EXCEEDS_REMAINING. |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 11.13 Attention Case

> GET /attention-cases/{id}  
> {  
> "id":"uuid",  
> "student":{...},  
> "status":"IN_FOLLOWUP",  
> "priority":"HIGH",  
> "reasons":\[  
> {"ruleKey":"absence.consecutive","severity":"HIGH","evidence":\[...\]}  
> \],  
> "lastContact":{...},  
> "nextFollowUp":{...}  
> }

## 11.14 WhatsApp Contact Draft / Outcome

> POST /attention-cases/{id}/contact-draft  
> {  
> "guardianId":"uuid",  
> "sessionId":"uuid"  
> }  
>   
> 200  
> {  
> "channel":"WHATSAPP_DEEPLINK",  
> "guardian":{"id":"uuid","maskedPhone":"\*\*\*1234"},  
> "draft":"السلام عليكم...",  
> "deepLink":"generated-at-client-or-safe-server-value"  
> }  
>   
> POST /contact-logs  
> {  
> "studentId":"uuid",  
> "guardianId":"uuid",  
> "attentionCaseId":"uuid",  
> "sessionId":"uuid",  
> "channel":"WHATSAPP_DEEPLINK",  
> "draftSnapshot":"...",  
> "outcome":"NO_ANSWER",  
> "followUpAt":"2026-08-23T18:00:00+03:00"  
> }

## 11.15 Team Invitation

> POST /team/invitations  
> {  
> "email":"assistant@example.com",  
> "roleLabel":"EXTERNAL_CENTER_ASSISTANT",  
> "grants":\[  
> {  
> "permission":"attendance.write",  
> "scope":{"type":"SELECTED_GROUPS","groupIds":\["uuid"\]}  
> },  
> {  
> "permission":"payments.record",  
> "scope":{"type":"SELECTED_GROUPS","groupIds":\["uuid"\]}  
> }  
> \]  
> }

الـserver يتحقق أن كل groupId من نفس Workspace وأن dependencies مثل payments.view_student_status تُحل وتتحقق Server-side. invitation token hashed/expiring ولا يكشف Membership خارج الحساب.

## 11.16 Billing Webhook

> POST /webhooks/paddle  
> Headers: provider signature + event id  
> Body: provider payload  
>   
> Processing:  
> 1) verify signature  
> 2) deduplicate provider event id  
> 3) map subscription state  
> 4) update Subscription  
> 5) update Entitlement(s)  
> 6) Audit where required  
> 7) Outbox event  
> 8) return 2xx only after durable commit

Redirect/checkout success page لا يمنح access. الـWebhook/provider backend هو مصدر حقيقة نجاح الدفع.

## 11.17 Report Export

> POST /reports/export  
> {  
> "type":"MONTHLY_TEACHER",  
> "format":"CSV",  
> "monthId":"uuid",  
> "filters":{}  
> }  
>   
> 200 for small export OR 202  
> {  
> "exportId":"uuid",  
> "status":"QUEUED"  
> }  
>   
> GET /exports/{id}  
> {  
> "status":"READY",  
> "downloadUrl":"short-lived-signed-url",  
> "expiresAt":"..."  
> }

V1 format الوحيد CSV UTF-8. لا PDF/XLSX في UI أو API. كل Export يحترم scope ويُسجل AuditEvent.

# 12. Error Catalog — نهائي

| **Code**                    | **HTTP**     | **المعنى**                                              | **Client Contract**                 |
|-----------------------------|--------------|---------------------------------------------------------|-------------------------------------|
| UNAUTHENTICATED             | 401          | لا Session/Token صالح.                                  | Redirect/login flow.                |
| SESSION_EXPIRED             | 401          | Session انتهت.                                          | لا claim بحفظ write غير مؤكد.       |
| FORBIDDEN                   | 403          | Permission/entitlement مفقود مع عدم حساسية وجود المورد. | Generic safe message.               |
| RESOURCE_NOT_FOUND          | 404          | غير موجود أو hidden by no-leak policy.                  | لا تفاصيل عن tenant آخر.            |
| VALIDATION_ERROR            | 422          | Schema/domain validation.                               | details.fieldErrors.                |
| RATE_LIMITED                | 429          | Rate limit.                                             | Retry-After عند توفره.              |
| VERSION_CONFLICT            | 409          | Optimistic concurrency conflict.                        | Reload latest.                      |
| IDEMPOTENCY_CONFLICT        | 409          | نفس key مع payload مختلف.                               | لا تنفيذ.                           |
| SUBSCRIPTION_REQUIRED       | 403          | Workspace منتهي/غير مدفوع لعملية محجوبة.                | Billing CTA.                        |
| ENTITLEMENT_BLOCKED         | 403          | Capability غير مسموحة.                                  | لا تعتمد على UI state.              |
| MONTH_ALREADY_EXISTS        | 409          | نفس workspace/year/month موجود.                         | Return existing metadata safe.      |
| MONTH_CREATE_FAILED         | 422/500      | Preview invalid/state changed أو failure.               | Atomic؛ no partial month.           |
| SESSION_INVALID_STATE       | 409          | Action غير صالح للحالة الحالية.                         | Return current status/version.      |
| SESSION_RECORDS_MISSING     | 422          | Required records ناقصة.                                 | details missing list.               |
| SESSION_ALREADY_COMPLETED   | 409/200 idem | Command مكرر بدون matching idempotency semantics.       | No effects rerun.                   |
| ENROLLMENT_NOT_ELIGIBLE     | 422          | طالب غير مؤهل للحصة/التاريخ.                            | Batch row detail.                   |
| BATCH_VALIDATION_FAILED     | 422          | صف أو أكثر غير صالح.                                    | Atomic batch; rows\[\] details.     |
| EXAM_SCORE_OUT_OF_RANGE     | 422          | score \<0 أو \> max.                                    | No partial save.                    |
| STUDENT_OUT_OF_SCOPE        | 404          | Safe no-leak.                                           | يفضل RESOURCE_NOT_FOUND externally. |
| GUARDIAN_CONTACT_DISABLED   | 422          | لا enabled valid guardian للقناة.                       | Disable WhatsApp CTA.               |
| QR_INVALID                  | 404          | غير معروف/Revoked/out-of-scope.                         | رسالة واحدة آمنة.                   |
| QR_NOT_ELIGIBLE_FOR_SESSION | 422          | طالب معروف داخل scope لكنه غير enrolled بالحصة.         | No attendance write.                |
| PAYMENT_EXCEEDS_REMAINING   | 422          | amount \> remaining.                                    | Return remainingMinor.              |
| PAYMENT_INVALID_AMOUNT      | 422          | amount\<=0/currency mismatch.                           | —                                   |
| PAYMENT_ALREADY_REVERSED    | 409          | لا reversal ثانية.                                      | No duplicate financial effect.      |
| OBLIGATION_NOT_PAYABLE      | 409          | Obligation state لا يسمح بالدفع.                        | —                                   |
| FOLLOWUP_INVALID_STATE      | 409          | Transition غير مسموح.                                   | Return current state.               |
| INVITATION_EXPIRED          | 410/422      | Token expired.                                          | Safe resend path.                   |
| PERMISSION_SCOPE_INVALID    | 422          | Group خارج workspace/invalid dependency.                | No partial grant.                   |
| EXPORT_NOT_ALLOWED          | 403          | reports.export/entitlement مفقود.                       | —                                   |
| EXPORT_NOT_READY            | 409/202      | طلب download قبل الجاهزية.                              | Return current status.              |
| INTERNAL_ERROR              | 500          | Unexpected.                                             | requestId mandatory; no secrets.    |

# 13. Search Contract

- Arabic normalization: Alef variants → ا، ى→ي، إزالة tatweel والتشكيل الاختياري، normalize whitespace/digits.

- Student search يدعم name normalized، Student ID، Guardian normalized phone؛ QR exact عبر /qr/resolve.

- الـscope/tenant filtering يتم قبل response؛ لا يتم جلب Global ثم تصفيته في الواجهة.

- لا expose rank/metadata يمكن أن يكشف records خارج scope.

- PostgreSQL + pg_trgm في V1؛ OpenSearch مستقبلًا فقط إذا Metrics تستدعي ذلك دون تغيير API semantics.

# 14. Date/Time and Money Contract

| **المجال**     | **القاعدة**                                                          |
|----------------|----------------------------------------------------------------------|
| Timestamp      | ISO 8601 مع Z أو offset؛ يخزن UTC.                                   |
| Workspace time | Business calendar/session eligibility حسب workspace.timezone.        |
| Date           | YYYY-MM-DD؛ join_date date وليس timestamp إلا إذا تغيّر Product Rule. |
| Time           | HH:mm local for ScheduleRule input.                                  |
| Money          | integer amountMinor؛ EGP 600.00 = 60000.                             |
| Currency       | currency: "EGP"؛ لا inference من locale.                             |
| Score          | number decimal؛ ليس minor units.                                     |
| Rounding       | Financial proration final HALF_UP إلى أقرب piastre وفق PRD.          |

# 15. Bulk & Atomicity Rules

| **العملية**       | **Atomicity** | **Failure behavior**                                                              |
|-------------------|---------------|-----------------------------------------------------------------------------------|
| Attendance batch  | Atomic        | أي invalid row → no rows committed.                                               |
| Homework batch    | Atomic        | أي invalid row → no rows committed.                                               |
| Exam scores batch | Atomic        | أي invalid score/eligibility → no rows committed.                                 |
| Create enrollment | Atomic        | Enrollment + Obligation succeed or rollback.                                      |
| Create month      | Atomic        | Month/configs/enrollments/obligations/sessions/outbox succeed or none.            |
| Record payment    | Atomic        | Payment + obligation aggregates + audit + outbox succeed or none.                 |
| Complete session  | Atomic core   | Session/records/final state/outbox commit together؛ downstream projections async. |
| Permission update | Atomic        | Grants/scopes/dependencies + audit succeed or none.                               |

# 16. Async Jobs Contract

| **Job**                  | **Trigger**                                 | **Idempotency/Result**                                                        |
|--------------------------|---------------------------------------------|-------------------------------------------------------------------------------|
| OutboxDispatch           | Committed outbox event                      | At-least-once delivery; consumer idempotent.                                  |
| EvaluateAttentionRules   | SessionCompleted / qualifying record change | One active case per student; safe rerun.                                      |
| FollowUpReminder         | ScheduledFollowUp due                       | Do not duplicate notification.                                                |
| MissingRecordsEvaluation | Session changes / scheduled scan            | Projection only; source SessionRecords.                                       |
| SubscriptionExpiry       | Scheduled check/provider event              | Entitlement state authoritative.                                              |
| GenerateCsvReport        | Export request when heavy                   | exportId stable; retryable.                                                   |
| TransactionalEmail       | Auth/invite/security flow                   | Retryable; no core write rollback because email provider failed after commit. |

Queue failure لا يسقط Core operation بعد commit. Core state + Outbox محفوظان، والWorker يعيد المعالجة.

# 17. Action Center Read Model Contract

> GET /action-center  
> {  
> "month":{"id":"uuid","label":"أغسطس 2026"},  
> "nextSession": {...},  
> "missingRecords":{"count":4,"items":\[...\]},  
> "followUpsDue":{"count":3,"items":\[...\]},  
> "attention":{"count":5,"items":\[...\]},  
> "monthSummary":{...},  
> "asOf":"timestamp"  
> }

Action Center Endpoint هو Aggregated Read Model لخفض round-trips، وليس مصدر الحقيقة. إذا projection متأخرة يمكن عرض asOf/refresh state دون تزوير freshness.

# 18. Security Contract

- HTTPS فقط في Production؛ Security headers وسياسات CORS حسب Web origins المعتمدة.

- Authentication verified server-side؛ service_role وأسرار Supabase/Paddle/Resend/R2 لا تصل للBrowser.

- كل Resource query Tenant-scoped؛ RLS دفاع إضافي وليس بديلًا عن Authorization.

- Rate limit أعلى صرامة على Auth، QR resolve، search، invitation/webhook abuse surfaces.

- Paddle webhooks signature-verified وidempotent؛ لا trust للredirect.

- Logs/Errors/Audit لا تحتوي password، auth token، QR raw token، billing secrets أو PII زائد عن الحاجة.

- Guardian phone يُmask عندما Permission لا تحتاج القيمة الكاملة؛ parent_contact فقط يحصل على enabled contact ضمن scope.

- OpenAPI لا يوثق Internal/Admin-only routes في public client bundle إلا إذا فصلت spec.

# 19. OpenAPI Organization

> docs/api/  
> openapi.yaml  
> components/  
> schemas.yaml  
> errors.yaml  
> security.yaml  
>   
> packages/contracts/  
> generated/  
> schemas/  
> client/

يجوز تقسيم OpenAPI إلى ملفات أثناء التطوير، لكن CI ينتج/يتحقق من Spec واحدة قابلة للقراءة. لا hand-written duplicate TypeScript interfaces تناقض العقد.

## 19.1 Tags

Auth, Me, Onboarding, Months, Groups, Schedules, Sessions, Students, Guardians, Enrollments, QR, Finance, Payments, Attention, FollowUps, Team, Subscriptions, Reports, Notifications, ActionCenter.

## 19.2 Required endpoint metadata

- summary/operationId ثابت

- authentication/workspace requirement

- permission + scope requirement

- entitlement requirement

- idempotency requirement

- concurrency/version rule

- request schema

- success response(s)

- documented error codes

- audit/outbox behavior عند الحساسية

- examples بالعربية حيث تفيد

# 20. API Anti-Patterns — ممنوعة

- Generic /crud أو /table/{tableName} endpoints.

- PATCH يسمح بأي field بدون whitelist/domain command.

- الاعتماد على workspace_id/user_id المرسل من العميل كAuthority.

- Direct browser writes إلى Business tables للعمليات الأساسية.

- Permission checks في UI فقط.

- Return raw DB rows أو token_hash/provider secrets.

- Float money أو automatic debt allocation.

- 200 OK مع {success:false} بدل HTTP semantics صحيحة.

- Silent retry ينتج duplicate payment/month/session effects.

- Offset pagination على hot large collections كافتراضي.

- N+1 queries في Action Center/Student 360/Finance queue.

- Claim “saved/completed” قبل durable server commit.

# 21. Contract / Integration Test Registry

| **ID** | **Scenario**                                                      | **Expected**                                                                   |
|--------|-------------------------------------------------------------------|--------------------------------------------------------------------------------|
| API-01 | Expired workspace cannot create month                             | 403 SUBSCRIPTION_REQUIRED; no partial rows.                                    |
| API-02 | Expired workspace cannot record payment/contact/operational write | Blocked; historical read remains.                                              |
| API-03 | Assistant searches out-of-scope student                           | Safe no-result/404; no existence leak.                                         |
| API-04 | Same payment Idempotency-Key same payload twice                   | One payment; same response.                                                    |
| API-05 | Same Idempotency-Key different payload                            | 409 IDEMPOTENCY_CONFLICT.                                                      |
| API-06 | Overpayment                                                       | 422; no payment/audit/outbox side effect except safe rejected log if designed. |
| API-07 | Complete session twice                                            | No duplicate rule/outbox effects.                                              |
| API-08 | Missing required records default flag false                       | 422 SESSION_RECORDS_MISSING.                                                   |
| API-09 | Absent student with homework                                      | Both persist independently.                                                    |
| API-10 | Absent from exam                                                  | No numeric zero stored.                                                        |
| API-11 | Student before join date                                          | Not present in roster.                                                         |
| API-12 | Revoked QR                                                        | Immediate safe invalid response.                                               |
| API-13 | QR valid but student not enrolled in session                      | No attendance mutation.                                                        |
| API-14 | Reschedule                                                        | Original RESCHEDULED + exactly one linked replacement.                         |
| API-15 | Stale version                                                     | 409 VERSION_CONFLICT; no overwrite.                                            |
| API-16 | Payment reverse twice                                             | Second blocked/no duplicate ledger effect.                                     |
| API-17 | Old + current debt                                                | Payment requires explicit obligationId.                                        |
| API-18 | payments.record assistant                                         | Can record but finance summary blocked without finance.overview.               |
| API-19 | CSV export scoped assistant                                       | Rows restricted to permission scope; audit created.                            |
| API-20 | Paddle duplicate webhook                                          | Processed once; entitlement stable.                                            |
| API-21 | Month create retry after network timeout                          | Same created month returned; no duplicate sessions/obligations.                |
| API-22 | Batch attendance one invalid enrollment                           | Whole batch rollback.                                                          |
| API-23 | Guardian secondary selected                                       | ContactLog references selected guardian.                                       |
| API-24 | Disabled membership                                               | All new protected actions blocked; audit history preserved.                    |
| API-25 | Action Center projection delayed                                  | Core data remains correct; no false freshness claim.                           |

# 22. API Versioning & Change Policy

- V1 paths ثابتة تحت /api/v1. Breaking semantic/schema change يتطلب API version strategy أو backward-compatible migration؛ لا كسر silent للعملاء.

- إضافة optional response field غالبًا backward-compatible؛ حذف/rename/تغيير معنى field ليس كذلك.

- OpenAPI diff في CI يكتشف breaking changes قبل merge.

- Product Business Rule جديد يحتاج PRD Change Request/Addendum أولًا، ثم Database/API impact assessment.

- Internal refactor أو provider migration لا يغيّر public API semantics بلا حاجة.

# 23. Performance & Scale Contract

| **المجال**               | **قاعدة التنفيذ**                                                                             |
|--------------------------|-----------------------------------------------------------------------------------------------|
| Simple operational reads | Indexed + scoped؛ target backend P95 أقل من ~500ms عند الحمل الطبيعي حيث عملي.                |
| Critical writes          | Transaction قصيرة؛ لا تنتظر email/report/analytics synchronously.                             |
| Session Mode             | Batch endpoints؛ no per-student network request loops.                                        |
| Action Center            | Aggregated read model endpoint؛ no 8–10 client requests requirement.                          |
| Collections              | Cursor pagination + selective fields.                                                         |
| Exports                  | Async عند الحجم الثقيل؛ signed URL.                                                           |
| API nodes                | Stateless; horizontal scale.                                                                  |
| Workers                  | Scale independently by queue pressure.                                                        |
| DB                       | Postgres indexes/read models/read replicas/partitioning حسب metrics؛ API contract يبقى ثابتًا. |

# 24. Implementation Mapping — NestJS

> apps/api/src/modules/  
> identity/  
> workspaces/  
> permissions/  
> months/  
> groups/  
> sessions/  
> students/  
> finance/  
> attention/  
> followup/  
> billing/  
> reports/  
> notifications/  
>   
> Each module:  
> api/controllers  
> application/use-cases  
> domain  
> infrastructure/repositories  
> contracts/tests

Controllers رفيعة: parse/validate/auth context → invoke Use Case → map response. لا Business Logic مالية/حالاتية داخل Controller.

# 25. Claude Code Guardrails

- لا ينشئ Endpoint جديدًا لتجاوز Business Rule موجود؛ يسجل gap/Change Request.

- لا يسمح للFrontend بالوصول المباشر إلى Supabase tables للـcore operations.

- لا يستخدم generic CRUD بدل Commands الحرجة.

- لا يعيد تعريف Money/Date/Status semantics في الواجهة.

- لا يضيف Permission أو Entitlement غير موجودة في الـCatalog/PRD بلا Addendum.

- لا يغير Error codes بعد استخدامها بدون versioned migration.

- لا يحول Jobs async إلى synchronous dependency توقف Core flows.

- لا يدعي PDF/XLSX في V1؛ CSV فقط.

- لا يبني Center Product ضمن Teacher V1، لكن يحافظ على Workspace abstraction.

- لا يسجل secrets/PII غير لازمة في logs/audit/error details.

# 26. Definition of Ready — API Contract CLOSED

| **المجال**                                   | **الحالة** |
|----------------------------------------------|------------|
| API base/version/style                       | CLOSED     |
| Authentication/workspace context             | CLOSED     |
| Permission + scope + entitlement enforcement | CLOSED     |
| Endpoint Registry                            | CLOSED     |
| Critical request/response schemas            | CLOSED     |
| Error Catalog                                | CLOSED     |
| HTTP status semantics                        | CLOSED     |
| Cursor pagination/filter/sort                | CLOSED     |
| Idempotency                                  | CLOSED     |
| Optimistic concurrency                       | CLOSED     |
| Session Golden Flow                          | CLOSED     |
| Student/Guardian/Enrollment/QR               | CLOSED     |
| Finance/Payments/Reversal                    | CLOSED     |
| Attention/Follow-up                          | CLOSED     |
| Team/Permissions                             | CLOSED     |
| Billing webhook semantics                    | CLOSED     |
| Reports CSV only                             | CLOSED     |
| Notifications/Action Center                  | CLOSED     |
| Async jobs boundary                          | CLOSED     |
| OpenAPI organization                         | CLOSED     |
| Contract tests                               | CLOSED     |
| Security/performance guardrails              | CLOSED     |

| **Final Status —** Academic Precision — Teacher V1 API Definition: CLOSED / APPROVED. لا توجد فجوة API Product حرجة تتطلب من Claude Code اتخاذ قرار Business من نفسه. المرحلة التالية: Implementation Plan + Claude Code Handoff Package، مع تحويل OpenAPI registry إلى specification executable أثناء التنفيذ. |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 27. Handoff Checklist للمرحلة التالية

- PRD V1.1 Final محفوظ كـProduct Source of Truth.

- Technical Architecture v1.0 Approved محفوظ.

- Database Schema v1.0 Approved محفوظ.

- API Contract v1.0 Approved هذا محفوظ.

- Reference Screen Registry الـ16 + Stitch references/design tokens متاحة في Handoff.

- Implementation Plan يقسم العمل إلى Phases/vertical slices مع migrations/tests/gates.

- Claude Code prompt يمنعه من تغيير Product/Architecture/DB/API contracts دون explicit Change Request.

- قبل Production: legal/privacy release gate، load/security/backup/restore checks، billing/auth provider integration verification.
