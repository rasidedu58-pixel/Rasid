وثيقة متطلبات المنتج النهائية \| عربية RTL \| مرجع تنفيذ موحّد لـClaude Code والتطوير وQA وUI/UX

| **الحقل**     | **القيمة**                                                             |
|---------------|------------------------------------------------------------------------|
| النسخة        | 1.1 Final                                                              |
| الحالة        | Approved for Technical Architecture & Implementation Planning          |
| النطاق        | Academic Precision — Teacher V1 فقط                                    |
| المستهدف      | Claude Code، Engineering، QA، UI/UX                                    |
| آخر تحديث     | 22 أغسطس 2026                                                          |
| لغة المنتج    | Arabic-first / RTL                                                     |
| مصدر القرارات | قرارات المنتج النهائية + منهجية PRD المرجعية دون نسخ مجالها أو محتواها |

| **مصدر الحقيقة — عند التعارض: Business Rules ثم Canonical Data Model ثم Acceptance Criteria ثم UI. لا يُنفذ سلوك جديد غير مذكور باعتباره Feature؛ يسجل Open Question أولًا.** |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 1. الملخص التنفيذي

Academic Precision هو نظام تشغيل دقيق وهادئ للمعلم الخصوصي لإدارة الشهر الدراسي، المجموعات، الحصص، الطلاب، المتابعة، التحصيل، والمساعدين من واجهة عربية RTL. ليس الهدف Dashboard مليئًا بالأرقام، بل منع الإدخال المتكرر وتحويل أحداث الحصة إلى سجل طلابي وإجراءات متابعة قابلة للتفسير.

| **المشكلة**     | **قرار Teacher V1**                            | **الأثر**                        |
|-----------------|------------------------------------------------|----------------------------------|
| إدخال متكرر     | Student ثابت + Enrollment شهري + Session فعلية | لا يُنشأ طالب جديد لكل حصة أو شهر |
| متابعة بلا سياق | Attention Case موحدة + rules                   | لا تتكرر Alerts لنفس الطالب      |
| تحصيل مبهم      | Obligation مستقلة + Payment Ledger             | كل دفعة مرتبطة باستحقاق          |
| تفويض غير آمن   | Role + Scope + Permissions                     | التفويض server-side لا UI فقط    |

# 2. رؤية المنتج والمبادئ

- Minimal UI + Maximum Operational Value: كل عنصر ظاهر يبرر المساحة التي يأخذها.

- Arabic RTL first: ليست واجهة مترجمة لاحقًا.

- Operational truth over decorative analytics: الإجراء التالي أهم من KPI الثانوي.

- Explainable rules, not AI: V1 قواعد صريحة وأدلة ظاهرة.

- Historical integrity: لا Hard Delete لبيانات تشغيلية أو مالية ذات أثر.

- One student, many enrollments: هوية الطالب ثابتة ونشاطه الشهري منفصل.

# 3. Scope وNon-goals

| **داخل V1**                          | **خارج V1**                                      |
|--------------------------------------|--------------------------------------------------|
| معلم وWorkspace واحد مع مساعدين      | Center Workspace أو اشتراك سنتر أو tenant للسنتر |
| Groups/Sessions/Students/Enrollments | LMS أو فيديو أو محتوى تعليمي                     |
| Attendance/Homework/Optional Exam    | AI prediction أو توصيات غير قابلة للتفسير        |
| Obligations/discounts/payments       | محاسبة قانونية أو تسوية بنكية آلية               |
| WhatsApp deeplink + outcome          | WhatsApp API أو إرسال صامت                       |
| Reports وCSV محدود                   | BI متقدم أو بوابة ولي أمر                        |

# 4. Personas وJobs to Be Done

| **الشخصية**               | **JTBD**                                                           | **نجاح**                         |
|---------------------------|--------------------------------------------------------------------|----------------------------------|
| Teacher Owner             | أريد تسجيل واقع الحصة بسرعة لأعرف من يحتاج تدخلاً ومن عليه مستحقات. | إتمام الحصة دون إدخال مكرر.      |
| Private Assistant         | أريد تنفيذ ما فوضت فيه فقط.                                        | يرى نطاقه ووظائفه فقط.           |
| External Center Assistant | أريد تسجيل حضور/دفعة للمجموعات المسندة لي.                         | لا يرى حساب المعلم أو إجمالياته. |
| Guardian                  | ليس مستخدمًا في V1؛ يتلقى تواصلًا قابلًا للمراجعة.                    | رسالة دقيقة غير آلية.            |

# 5. Information Architecture

| **المساحة**        | **الغرض**          | **العناصر**                                                          |
|--------------------|--------------------|----------------------------------------------------------------------|
| Action Center      | تشغيل لا Dashboard | الحصة القادمة، attention، متابعات اليوم، missing records، ملخص الشهر |
| Months             | السياق والتاريخ    | switcher، new month، archive                                         |
| Groups             | إدارة المجموعة     | list، details، schedule، students، assistants، sessions              |
| Students           | السجل الدائم       | search، QR، Student 360، enrollments                                 |
| Session Mode       | تنفيذ الحصة        | attendance، homework، exam، review                                   |
| Follow-up          | الحالات الموحدة    | queue، reasons، outcomes، defer                                      |
| Finance            | الاستحقاقات        | collection queue، payment ledger                                     |
| Team & Permissions | المساعدون          | invitations، scope، permissions، audit                               |
| Reports            | قراءة وتصدير       | attendance/homework/exams/finance/missing records                    |

| **سياق الشهر — كل شاشة تشغيلية تعرض Month Switcher. الشهر المؤرشف متاح للعرض والتقارير؛ لا يسمح بخلط الكتابة بين الشهور.** |
|----------------------------------------------------------------------------------------------------------------------------|

# 6. Roles / Permissions

| **القدرة**                    | **Owner** | **Assistant** | **External Center Assistant** |
|-------------------------------|-----------|---------------|-------------------------------|
| إدارة workspace/اشتراك        | كامل      | لا            | لا                            |
| إدارة group/schedule          | كامل      | بإذن + scope  | لا افتراضيًا                   |
| attendance.write              | كامل      | اختياري       | اختياري                       |
| homework.write/exams.write    | كامل      | اختياري       | لا افتراضيًا                   |
| payments.record               | كامل      | اختياري       | اختياري                       |
| finance.overview              | كامل      | لا افتراضيًا   | لا                            |
| parent_contact/followup.write | كامل      | اختياري       | لا افتراضيًا                   |
| students.view_basic           | كامل      | حسب scope     | ضمن groups فقط                |

Role هو label للعرض فقط. قرار الوصول الحقيقي = Permission + Scope (all groups أو selected groups). كل API يثبت workspace_id وmembership وgroup scope؛ إخفاء الـNavigation لا يعد حماية.

# 8. Lifecycle / State Machines

| **الكائن**     | **الحالات**                                        | **الانتقالات**                                          |
|----------------|----------------------------------------------------|---------------------------------------------------------|
| OperatingMonth | Draft → Current → Archived                         | إنشاء ناجح فقط؛ لا حذف بعد التشغيل                      |
| Session        | Scheduled → In Progress → Completed                | Scheduled → Cancelled/Rescheduled؛ لا delete مع records |
| Enrollment     | Pending/Active → Stopped/Withdrawn/Transferred     | لا يظهر قبل join_date                                   |
| Obligation     | Unpaid → Partial → Paid; → Overdue                 | Overdue مشتق من due date + remaining                    |
| Payment        | Posted → Voided/Reversed                           | سبب + audit؛ لا delete                                  |
| AttentionCase  | New → In Follow-up → Contacted/Monitoring → Closed | تصعيد عند استمرار الأدلة                                |
| Subscription   | Trial/Active → Expiring → Expired/Unpaid           | entitlement شرط new month                               |

# 9. Module: الشهر، المجموعة، وتوليد الحصص

| **User Story**               | **UI fields**                                                            | **Business rules / acceptance**                                                             |
|------------------------------|--------------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| كمعلم أختار سياسة الاستحقاق. | موحد لكل المجموعات / منفصل لكل مجموعة / default day                      | day=1..28؛ تغيير السياسة current يحتاج confirmation؛ default للتغيير هو groups الجديدة فقط. |
| كمعلم أنشئ شهرًا.             | target month، groups selected، review                                    | لا month مكرر؛ entitlement Active؛ العملية idempotent/transactional.                        |
| كمعلم أنشئ group بجدول.      | name، grade، subject، location، fee، due override، weekday/time/duration | يوم واحد على الأقل؛ fee≥0؛ يولد occurrence الفعلي داخل الشهر لا عدد ثابت.                   |
| كمعلم أعدل schedule.         | future sessions affected preview                                         | المكتملة ثابتة؛ cancel/reschedule لا delete؛ exception session مسموحة.                      |

- Carry Forward يرحّل: students، IDs، guardians، QR، groups بعد review، schedule، locations، assistants، prices، due policy.

- لا يرحّل: attendance، homework، exams، payments، monthly missing records، monthly performance، follow-ups المغلقة.

- Final preview يعرض groups carried، continuing/excluded/transferred students، generated sessions، new obligations، students with old debt.

- الاشتراك غير النشط يمنع إنشاء الشهر فقط؛ لا يمنع قراءة التاريخ والتقارير.

# 10. Module: الطالب وEnrollment الشهري

| **السلوك**        | **تفاصيل**                                                                 | **Validation**                                                                                     |
|-------------------|----------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| Add Student       | name، guardian phone، optional basic data؛ student_code وQR يولدان تلقائيًا | تحقق format للهاتف؛ عرض matches محتملة قبل الإنشاء دون merge آلي                                   |
| Enroll            | group/month/join_date/fee method                                           | active enrollment واحد لنفس student/group/month                                                    |
| Mid-month         | Full / Custom / Remaining sessions                                         | Remaining=monthly fee ÷ actual monthly sessions × sessions on/after join_date؛ يعرض ويعدل قبل save |
| Student 360       | identity، summary strip، timeline، attention، obligations                  | يعرض التاريخ دون دمج ديون الشهور                                                                   |
| Transfer/Withdraw | effective date/reason                                                      | لا حذف الطالب أو بيانات الشهر السابق                                                               |

| **قاعدة دقيقة — الطالب المنضم منتصف الشهر لا يظهر في sessions السابقة لتاريخ الانضمام، ولا تعد غيابًا. سياسة المجموعة الافتراضية: Ask every time، ويمكن اختيار full month أو remaining sessions.** |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 11. Module: Session Mode

| **المرحلة**   | **UI/actions**                                   | **Rules**                                                        |
|---------------|--------------------------------------------------|------------------------------------------------------------------|
| Start         | Start Session، autosave state                    | Scheduled→In Progress؛ لا session موازية لنفس ID                 |
| Attendance    | الكل حاضر، حاضر، غائب، متأخر، search، QR         | الحالة صريحة؛ bulk reversible؛ QR لا يكشف خارج scope             |
| Homework      | الكل أدى، أدى، مقصر، لم يؤد، لا يوجد واجب        | الغياب لا يمنع تسجيل واجب؛ no homework لا missing                |
| Exam optional | has exam، name optional، max score، score/absent | max\>0؛ absent ليس 0 تلقائيًا                                     |
| Review        | summary، missing records، Complete               | استكمال الناقص أو complete with gaps فقط إن policy تسمح          |
| Complete      | confirmation                                     | يحدث Student 360/timeline/rules/reports/action center atomically |

Mobile: touch targets ≥44px؛ أهم action في reach zone؛ لا معنى يعتمد اللون وحده؛ sticky CTA لا يحجب rows؛ Autosave يعرض Saved/Saving/Offline/Sync issue بهدوء.

# 12. Module: Unified Attention Case + Rule Engine

V1 Rule-based لا AI. بعد Complete أو change مؤثر، ينشئ أو يحدّث AttentionCase واحدة نشطة للطالب وتتضمن Reasons متعددة بأدلة sessions/records ووقت الحساب.

| **Rule**             | **الشرط الافتراضي**            | **الناتج**              |
|----------------------|--------------------------------|-------------------------|
| absence.consecutive  | غياب حصتين متتاليتين           | reason                  |
| absence.frequency    | 3 من آخر 5 eligible sessions   | reason                  |
| homework.consecutive | لم يؤد مرتين متتاليتين         | reason                  |
| homework.frequency   | مقصر/لم يؤد في 3 من آخر 4      | reason                  |
| exam.low             | درجتان متتاليتان تحت threshold | reason                  |
| exam.drop            | هبوط واضح عن الأداء السابق     | threshold Open Question |
| combined.medium      | عدة مؤشرات متوسطة              | سبب موحد/priority أعلى  |

- لا alert لغياب منفرد.

- تحسن الطالب يقترح close ولا يغلق تلقائيًا دون policy.

- استمرار الدليل بعد التواصل يصعّد priority ويبقي case نفسها.

- open case يعبر الشهر؛ closed case History فقط.

# 13. Module: WhatsApp guardian follow-up

| **الخطوة** | **التنفيذ**                                                                           |
|------------|---------------------------------------------------------------------------------------|
| Queue      | صف لكل AttentionCase يعرض الطالب، الأسباب، next action، last contact، follow-up time. |
| Compose    | Draft عربي من سياق session وسبب فعلي؛ قابل للتحرير قبل الفتح.                         |
| Open       | WhatsApp deep-link فقط؛ لا claim للإرسال أو التسليم.                                  |
| Return     | outcome=تم التواصل/لم يرد/الرقم غير صحيح/تأجيل.                                       |
| Defer      | date/time إلزامي؛ يظهر في queue الموعد.                                               |
| Audit      | ContactLog يحفظ draft snapshot، outcome، actor، time.                                 |

| **قالب المسودة — السلام عليكم، مع حضرتك أ/ {teacher}. ملخص {student} في حصة {subject} اليوم: الحضور {attendance}، الواجب {homework}، {exam_clause}. نرجو المتابعة. — قابلة للتعديل.** |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 14. Module: Finance / Financial Obligations

المالية Ledger تحصيل تشغيلي وليست محاسبة عامة. لكل Enrollment FinancialObligation مستقلة: Base fee، Discount، Waiver، Net due، Paid، Remaining، Due date، Status. Discount/Waiver ليسا Payment.

| **Flow**         | **Rules**                                                                                    |
|------------------|----------------------------------------------------------------------------------------------|
| Add Payment      | Student/Queue → اختر obligation صراحة إن تعددت → amount/method/date/note → review → confirm. |
| Methods          | cash، transfer، wallet، other.                                                               |
| Validation       | amount\>0 وamount≤remaining؛ يمنع overpayment وcredit balance في V1.                         |
| Review           | required، paid before، remaining before/after.                                               |
| Correction       | Void أو Reverse بسبب إلزامي ثم new payment؛ لا delete.                                       |
| Collection Queue | student، due/paid/remaining/status/due state + WhatsApp/Add payment/View.                    |

| **متأخرات الشهور — 300 من أغسطس و600 من سبتمبر = Obligationان مستقلان وإجمالي 900. الدفعة لا توزع تلقائيًا؛ يختار المعلم الاستحقاق صراحة.** |
|--------------------------------------------------------------------------------------------------------------------------------------------|

# 15. Subscription وMonthly Lifecycle

| **الحالة**     | **السلوك**                                              |
|----------------|---------------------------------------------------------|
| Active paid    | Create New Month مسموح                                  |
| Trial valid    | حسب quota/configuration المعلنة فقط                     |
| Expiring       | تنبيه هادئ قبل 5-7 أيام                                 |
| Expired/Unpaid | زر Create New Month مقفول؛ historic read/reports متاحان |
| Renewed        | يفتح الإنشاء فورًا دون إعادة onboarding                  |

| **Gate message — يلزم تجديد الاشتراك لبدء شهر جديد. يمكنك الاستمرار في عرض بياناتك وتقارير الشهور السابقة، لكن إنشاء شهر جديد يتطلب اشتراكًا نشطًا.** |
|-----------------------------------------------------------------------------------------------------------------------------------------------------|

# 16. Assistants وCenter Context

السنتر في Teacher V1 Location/Operating Context فقط، وليس tenant أو حسابًا مشتركًا. External Center Assistant مدعو من المعلم ومربوط فقط بالمجموعات المحددة داخل هذا الحساب؛ قد يكون مساعدًا عامًا للسنتر في الواقع دون أن يرى مدرّسين آخرين داخل النظام.

| **سيناريو**    | **Grant نموذجي**                                                                | **ممنوع**                               |
|----------------|---------------------------------------------------------------------------------|-----------------------------------------|
| مساعد سنتر     | scope=Group A؛ attendance.write, payments.record, students.view_basic           | finance.overview، groups أخرى، settings |
| مساعد خاص      | scope=all/selected؛ homework.write, exams.write, parent_contact, followup.write | permissions management                  |
| مساعد حضور فقط | scope=selected؛ attendance.write                                                | homework/exams/payments/finance         |

- payments.record ≠ finance.overview.

- دعوات وتغييرات permissions والتعطيل تسجل Audit.

- التعديل المتزامن يستخدم optimistic concurrency؛ لا last-write-wins صامت.

- إلغاء membership يمنع actions جديدة ولا يمحو تاريخ actor.

# 17. UI/UX Contract

| **المجال**    | **قاعدة**                                                                          |
|---------------|------------------------------------------------------------------------------------|
| Arabic/RTL    | لا placeholder بدل label؛ أرقام ومبالغ مقروءة؛ semantic states بالنص+shape+color.  |
| Action Center | next session ثم attention ثم follow-ups ثم missing ثم month summary.               |
| Student 360   | header بسيط + summary strip للحضور/الواجب/الاختبار/remaining + timeline.           |
| Finance       | required/collected/remaining/rate ثم queue؛ لا charts للزينة.                      |
| Responsive    | Desktop 1280+؛ mobile ليس تصغيرًا؛ bottom sheets وnavigation خفيف.                  |
| States        | loading/empty/saving/success/error/offline/disabled مع microcopy عربي واضح.        |
| Accessibility | AA contrast، keyboard desktop، focus visible، touch≥44px، اللون ليس المعنى الوحيد. |

# 18. Search، QR، Reporting، Notifications

| **الميزة**    | **متطلبات V1**                                             | **حدود**                                  |
|---------------|------------------------------------------------------------|-------------------------------------------|
| Search        | الاسم، student_code، guardian phone normalized             | scope enforced؛ لا global fuzzy غير محدد  |
| QR            | qr_token آمن → lookup + enrollment context                 | ليس access token ولا يحمل PII             |
| Reports       | attendance/homework/exams/finance/missing حسب month/group  | filters أساسية + CSV UTF-8 Arabic headers |
| Export        | report type/filter scope/audit export                      | permission scoped                         |
| Notifications | in-app للـdeferred follow-up/missing/subscription expiring | لا Push/SMS/WhatsApp auto send            |

# 19. Validations، Messages، Edge Cases

| **الحالة**             | **Expected behavior / message**                                       |
|------------------------|-----------------------------------------------------------------------|
| QR غير معروف           | لم نتمكن من العثور على طالب بهذا الرمز. Retry / Search.               |
| QR خارج session        | الطالب موجود لكنه غير مسجل في هذه المجموعة/الشهر.                     |
| درجة غير صالحة         | الدرجة يجب أن تكون بين 0 و{max}.                                      |
| دفعة أكبر من المتبقي   | المبلغ يتجاوز المتبقي. لا يدعم V1 رصيدًا دائنًا.                        |
| إكمال ناقص             | توجد سجلات ناقصة. أكملها أو أنهِ الحصة مع النقص وفق السياسة.           |
| رقم ولي غير صالح       | تحذير format قبل WhatsApp؛ الحفظ وفق policy.                          |
| تغيير schedule         | future impact preview؛ لا تعديل للمكتمل.                              |
| Offline session        | queue محلية + Sync issue؛ لا completed claim قبل server confirmation. |
| Double submit payment  | idempotency key؛ transaction واحدة.                                   |
| Unauthorized assistant | 403 آمن + audit؛ لا تسريب وجود entity.                                |

# 20. Security، Privacy، Audit

- Authentication وserver-side authorization لكل API؛ منع IDOR بفرض workspace وscope.

- guardian phone محمي in transit/at rest ويُmask حيث لا يلزم كاملاً.

- Audit append-only لـattendance/homework/exam edits، payments/reversals، discounts/waivers، permissions، exports، student statuses.

- QR عشوائي غير قابل للتخمين؛ rate limit على QR/search.

- لا ادعاء compliance قانوني محدد: retention، consent، deletion، وlegal requirements Open Question قبل production.

# 21. Non-functional Requirements

| **البعد**     | **Requirement**                                                                     |
|---------------|-------------------------------------------------------------------------------------|
| Performance   | P95 read operational ≤2s؛ record save ≤1s عند اتصال طبيعي.                          |
| Integrity     | FK/unique constraints، transaction boundaries، idempotency لـmonth/session/payment. |
| Reliability   | integration failure مثل WhatsApp لا يمنع core operation.                            |
| Responsive    | 360px mobile بدون horizontal scroll في Session Mode.                                |
| Observability | structured logs، correlation ID، error tracking بلا PII غير لازم.                   |
| Localization  | RTL، EGP formatting، timezone workspace، Gregorian dates.                           |

# 22. Analytics Events

| **Event**                              | **properties**                          | **غرض**                          |
|----------------------------------------|-----------------------------------------|----------------------------------|
| month_create_started/completed/blocked | month, group_count, block_reason        | lifecycle/subscription friction  |
| session_started/completed              | group_id, duration, missing_count       | operational completion           |
| attention_case\_\*                     | rule_keys, priority, age                | quality of action engine         |
| whatsapp_draft_opened/outcome_saved    | case_id, outcome                        | follow-up without delivery claim |
| payment_posted/reversed                | method, amount bucket, obligation month | collection health                |
| assistant_permission_changed           | permission, scope                       | delegation risk                  |
| export_created                         | report/filter scope                     | report usage/security            |

# 23. Acceptance Criteria — Golden Flow

- Owner يختار due-date policy وينشئ month مع entitlement Active.

- Group schedule يولد actual calendar sessions.

- Student ينشأ مرة واحدة؛ mid-month enrollment لا يظهر قبل join date.

- Remaining fee يُعرض قبل الحفظ؛ obligation تنشأ.

- Session attendance/homework/optional exam/review/complete تحدث كل downstream records.

- غياب وواجب لنفس الطالب ينتجان case واحدة بأسباب متعددة.

- WhatsApp draft قابل للتحرير ثم outcome/defer مسجل.

- Partial payment يحدث ledger بلا overpayment.

- New month carries structure ويترك old debt مستقلاً.

- Expired subscription يمنع new month فقط.

- External Center Assistant في group محدد يستطيع attendance/payment فقط ولا يرى Finance overview.

# 24. QA Test Scenarios

| **ID** | **السيناريو**                 | **Expected**                          |
|--------|-------------------------------|---------------------------------------|
| QA-01  | Saturday/Tuesday في شهر قصير  | actual occurrences فقط                |
| QA-02  | Enroll في اليوم 20            | لا historical attendance              |
| QA-03  | No homework                   | لا homework missing                   |
| QA-04  | Exam absent                   | absent لا صفر                         |
| QA-05  | Complete with gaps            | policy enforced                       |
| QA-06  | 2 absence + homework issue    | one case / multiple reasons           |
| QA-07  | Defer follow-up               | scheduled queue + log                 |
| QA-08  | partial + reverse             | accurate remaining + immutable ledger |
| QA-09  | old + current debt            | explicit allocation                   |
| QA-10  | expired create month          | blocked/no partial data               |
| QA-11  | assistant finance request     | 403/no leakage                        |
| QA-12  | concurrent attendance edits   | conflict/version behavior             |
| QA-13  | invalid QR                    | safe/no PII                           |
| QA-14  | double payment confirmation   | one transaction                       |
| QA-15  | schedule edit after completed | completed unchanged                   |

# 25. Risks، Assumptions، Open Questions

| **النوع**  | **البند**                                    | **قرار مطلوب**                                                        |
|------------|----------------------------------------------|-----------------------------------------------------------------------|
| Assumption | EGP + Gregorian + workspace timezone         | قابل للتهيئة لاحقًا                                                    |
| Risk       | WhatsApp deeplink لا يؤكد delivery           | outcome يدوي ولا claim delivery                                       |
| Risk       | schedule change بعد fee                      | لا يغير obligation صامتًا                                              |
| Open       | exam low threshold وdrop definition          | Product default/config before build                                   |
| Open       | هل يسمح Complete with gaps؟                  | Product policy/feature flag                                           |
| Open       | invitation/OTP/recovery design               | Security/Product decision                                             |
| Open       | data retention/consent/legal                 | Legal/Product review                                                  |
| Open       | Trial/billing provider/invoices              | Commercial/technical decision                                         |
| Note       | PRD المرجعي لم يتوفر محليًا للاستخراج المباشر | استُخدمت منه المنهجية المذكورة: stories→fields→flow→rules→messages فقط |

# 26. Migration وReadiness

- لا legacy migration مفترض. أي import مستقبلي: CSV staged → validation → duplicate preview → explicit mapping → import log → rollback window.

- Seed data: شهران، groups متعددة، active/withdrawn students، old debt، completed/cancelled sessions، scoped assistants.

- Feature flags: complete_with_gaps، exam_drop_rule، trial entitlement.

- Release readiness: forward-only migrations، backup/restore drill، RBAC tests، payment idempotency، RTL visual regression، mobile session usability pass.

# 27. Developer Handoff Checklist

| **المجال**      | **لا يكتمل بدون**                                              |
|-----------------|----------------------------------------------------------------|
| Domain          | schema، constraints، transition guards، transaction boundaries |
| Authorization   | automated permission/scope tests                               |
| Money           | Decimal/fixed minor units، immutable ledger، idempotency       |
| Sessions        | calendar generator tests لحدود الشهور/exceptions               |
| UI              | 16 reference screens + tokens + component/state rules          |
| QA              | golden flow + QA-01…QA-15                                      |
| Observability   | audit/error/analytics contract                                 |
| Handoff package | هذا PRD + screenshots + design tokens + component rules + ADRs |
| Change control  | أي scope جديد = PRD addendum لا minor UI change                |

| **Definition of Ready — Teacher V1 جاهز للتنفيذ عندما تتحول Open Questions إلى قرارات، وتثبت شاشات المرجع، ويوافق الفريق على Data Model وAcceptance Criteria وPermission Matrix. لا يبدأ Center Product ضمن هذا التسليم.** |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 28. Product Authority and Final Status

| Approved for Technical Architecture & Implementation Planning |
|---------------------------------------------------------------|

ترتيب Source of Truth الملزم: 1) Business Rules، 2) Canonical Data Model، 3) State Machines، 4) Permissions Matrix، 5) Acceptance Criteria، 6) UI/UX Contract، 7) Reference Screens. إذا تعارض Screenshot مع Business Rule، تتقدم Business Rule.

# 29. Authentication & Owner Onboarding

## 29.1 Owner Sign Up

User Story: As a Teacher Owner who wants a private workspace.

Description: إنشاء owner وworkspace تلقائيًا مع أقل إدخال ممكن.

Preconditions: لا توجد Session مصادق عليها.

UI Fields: full name، email، password، email verification link/code.

User Flow: Sign up → verify identity → create User/AuthIdentity/Workspace atomically → start authenticated session → onboarding.

Business Rules: Workspace واحد ينشأ تلقائيًا للـowner؛ لا تخزن password plaintext؛ identity uniqueness per provider/value normalized.

Validation: full name required؛ لا يسمح duplicate verified identity؛ rate limit للتحقق.

States: loading، verification pending، success، invalid code، duplicate identity، network error.

UI Messages: تم إنشاء مساحة عملك. / تعذر التحقق. راجع الرمز وحاول مجددًا.

Business Rule: Email + Password فقط في V1؛ الهاتف اختياري كبيان ملف شخصي ولا يستخدم للمصادقة.

Acceptance Criteria: Given verified identity, When signup completes, Then User + Workspace + Owner Membership exist exactly once.

## 29.2 Login, Recovery, Session, Logout

User Story: As a Authenticated user returning to the product.

Description: دخول آمن، استعادة لا تكشف وجود حساب، وإدارة جلسة واضحة.

Preconditions: AuthIdentity موجودة وaccount active.

UI Fields: identifier، credential/OTP، forgot password، logout all devices optional.

User Flow: Login → verify → create secure session → load authorized workspace; Recovery → generic confirmation → verified recovery path.

Business Rules: sessions revoke on logout; server validates membership on every request; no credential logs.

Validation: generic response for unknown identifier; rate limiting and expiry follow the selected identity provider security configuration.

States: loading، authenticated، expired session، locked/rate limited، recovery sent.

UI Messages: إذا كان الحساب موجودًا سنرسل تعليمات الاستعادة عند الإمكان.

Edge Cases: لا تعرض workspace أو email/phone identity لمستخدم غير مصرح.

Acceptance Criteria: Given expired session, When protected route is opened, Then user is redirected to login and unsaved server write is not claimed saved.

## 29.3 Initial Onboarding

User Story: As a New Teacher Owner who needs to start fast.

Description: Onboarding قصير ولا يطلب بيانات غير تشغيلية.

Preconditions: Authenticated owner with new workspace.

UI Fields: teacher display name، subjects optional، due-date policy unified/per group، unified due day if selected، optional assistant setup skip.

User Flow: Complete/Skip assistant → land on Action Center or Create Month.

Business Rules: لا group أو month إلزامي أثناء onboarding؛ due day 1..28؛ subjects optional.

Validation: display name required؛ unified day required فقط إذا unified policy.

States: saving، skipped، completed، inline validation.

UI Messages: يمكنك إضافة المساعدين لاحقًا من Team & Permissions.

Edge Cases: خروج المستخدم قبل completion يحفظ draft أو يعيد له onboarding حسب technical decision.

Acceptance Criteria: Given per-group policy, When onboarding completes, Then no unified due day is required.

# 7. Canonical Data Model

| **Entity**                 | **Required fields / keys**                                                                                                                                        | **Integrity, scope, archive**                                                                    |
|----------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| User                       | id, full_name, created_at, updated_at                                                                                                                             | global identity; no workspace data implied                                                       |
| AuthIdentity               | id, user_id, provider, identifier_normalized, verified_at, credential_hash/secret_ref nullable                                                                    | unique(provider,identifier_normalized); never plaintext password                                 |
| Workspace                  | id, owner_user_id, timezone, locale, due_date_policy, unified_due_day nullable                                                                                    | all operational entities workspace-scoped                                                        |
| Membership                 | id, workspace_id, user_id, role_label, status, timestamps                                                                                                         | unique(workspace,user); disabled preserves audit                                                 |
| PermissionGrant/GroupScope | id, membership_id, permission_key, scope_type, group_id nullable                                                                                                  | grant/query must verify workspace+membership+permission+scope                                    |
| Subscription               | id, workspace_id, provider_ref nullable, state, period_start/end                                                                                                  | commercial record separate from access decision                                                  |
| Entitlement                | id, workspace_id, capability, state, effective_from/to, source                                                                                                    | authoritative capability gate; source subscription/trial/admin                                   |
| Group                      | id, workspace_id, name, subject, grade, default_location_id nullable, status, created_at, archived_at nullable                                                    | stable identity across months; archived not deleted                                              |
| GroupMonth                 | id, group_id, operating_month_id, location_id override, base_fee, due policy/day, monthly_status                                                                  | unique(group_id,operating_month_id); monthly overrides only                                      |
| Guardian                   | id, workspace_id, name nullable, phone, normalized_phone, timestamps                                                                                              | shared across siblings; unique workspace+normalized_phone only if product approves de-dup policy |
| StudentGuardian            | student_id, guardian_id, relationship nullable, is_primary, academic_contact_enabled, financial_contact_enabled                                                   | many-to-many; one primary per student enforced by partial unique constraint                      |
| Student                    | id, workspace_id, student_code, name, timestamps, archived_at                                                                                                     | Student ID stable; no guardian_phone field                                                       |
| Enrollment                 | id, student_id, group_month_id, join_date, status                                                                                                                 | unique active enrollment per student/group_month                                                 |
| Session                    | id, group_month_id, scheduled_at, duration, status, origin, rescheduled_from_session_id nullable                                                                  | timezone from Workspace; original retained on reschedule                                         |
| QRCredential               | id, student_id, token_hash, status, issued_at, revoked_at, reason, actor_id                                                                                       | one active credential; token contains no PII                                                     |
| ContactLog                 | id, student_id, guardian_id, attention_case_id nullable, session_id nullable, channel, draft_snapshot, outcome, notes, follow_up_at nullable, actor_id, timestamp | immutable snapshot; selected guardian explicit                                                   |
| ScheduledFollowUp          | id, attention_case_id, due_at, status, assignee nullable                                                                                                          | may be derived from ContactLog but stored separately for queue                                   |
| AuditEvent                 | id, workspace_id, actor_id, action, entity_type, entity_id, before_json, after_json, reason nullable, metadata_safe, timestamp                                    | append-only; redact secrets/PII from metadata                                                    |

| **Deletion policy — Operational records, payments, audit, and credentials are never hard-deleted in ordinary product flows. Use archive/withdraw/cancel/void/revoke with actor, time, and reason where required.** |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 31. Guardian and Contact Behavior

- Student 360 shows the Primary Guardian by default.

- WhatsApp selects Primary Guardian unless the teacher chooses an enabled secondary guardian.

- If no valid enabled normalized phone exists, WhatsApp CTA is disabled with: “لا يوجد رقم ولي أمر صالح للتواصل.”

- Guardian can be related to multiple students; each StudentGuardian stores relationship and academic/financial contact permissions.

- No Parent Portal, guardian login, or automatic messaging in Teacher V1.

# 32. Subscription Entitlement Matrix

| Confirmed rule — No active paid entitlement = no new month creation. Historical read access remains. No Grace Period is supported in V1. |
|------------------------------------------------------------------------------------------------------------------------------------------|

# 33. Closed Financial and Session Generation Rules

## 33.1 Mid-month financial formula

prorated_due = base_fee × eligible_remaining_sessions ÷ total_actual_billable_sessions. Money is stored as integer EGP minor units (piastres) or fixed Decimal; never binary floating point. Display uses EGP formatting and two decimal places only when non-zero minor units exist. Rounding: half-up to the nearest piastre, once at the final result.

- total_actual_billable_sessions counts generated billable occurrences in GroupMonth after schedule generation; a month with 4 or 5 occurrences follows actual calendar.

- Cancelled sessions are excluded. A reschedule replaces its original: it counts once, not twice.

- Manual extra session is excluded from proration unless the teacher marks billable_for_proration=true before enrollment calculation; default false.

- If total_actual_billable_sessions=0, Remaining sessions option is unavailable with message “لا توجد حصص قابلة للحساب هذا الشهر؛ اختر مبلغًا كاملاً أو مخصصًا.”

- Join-date eligibility: scheduled date-time on/after join_date in Workspace timezone is eligible; same-day session is eligible.

- Preview shows base fee, eligible/total, formula, rounded result; Custom may override and creates an auditable amount basis.

## 33.2 Schedule, reschedule, and change impact

- ScheduleRule → occurrences within OperatingMonth boundaries using Workspace timezone, weekday, start time, duration. No fixed count.

- Reschedule keeps original Session with status Rescheduled, sets replacement.rescheduled_from_session_id=original.id, and creates one replacement Scheduled session. No records are copied automatically.

- Changing schedule, fee, due date, or location after records exist requires Impact Preview. Schedule preview lists future session changes; completed sessions never move.

- Fee change offers only: Apply to new enrollments only; Apply to existing unpaid obligations (explicit selection, recalculated and audited); Do not alter current-month obligations. Paid/partial obligations cannot be silently changed.

- Due date/location changes apply only to selected GroupMonth and future related behavior; audit mandatory.

## 33.3 QR lifecycle

- Student ID never changes. QR contains/represents an opaque random credential, never PII.

- Exactly one active QRCredential per student. Reissue requires confirmation, optional reason, actor/time audit; old credential becomes Revoked/Invalid immediately.

- Global search QR: returns only authorized in-scope student context. Session Mode: validates enrollment in current session. Payment context: may open only authorized student financial status, never a global finance aggregate.

- Out-of-scope or invalid scan returns a safe no-leak response; no distinction that reveals another workspace student.

# 34. Explicit Behavior Flags and Rule Closure

| **Area**           | **Decision**                                                                                                                                                                                                                                                                                                                                                            |
|--------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Complete with gaps | Feature flag complete_session_with_missing_records. Default False. Required missing records block completion. No homework and absent_from_exam are resolved states, not missing. If True: confirmation + gaps remain in Missing Records + AuditEvent.                                                                                                                   |
| Exam               | Optional; max_score\>0; score 0..max; absent_from_exam is separate and never coerced to zero. exam.low uses configurable group threshold that must be set before rule enabled. exam_drop_rule feature flag disabled by default until mathematical definition is approved.                                                                                               |
| Attention Case     | unique active case per (workspace_id, student_id). Reasons/evidence pointers multiple. Priority: base max reason priority; escalation +1 capped at High when new qualifying evidence appears after Contacted/Monitoring. Reopen closed case only upon a new qualifying rule after closure. Crosses months until closed; never auto-closes merely because month changes. |
| Offline            | No full offline support is promised. UI may show connectivity/pending states but may not state “تم الحفظ” until server confirmation. Durable local queue is Technical Architecture TBD, not a product claim.                                                                                                                                                            |
| Notifications      | In-app only: subscription expiry, follow-up due, missing records. read/unread exists: new=unread; user marks read; action may mark read; no auto WhatsApp/SMS.                                                                                                                                                                                                          |

# 35. Permission Catalog and Enforcement

| **Permission**                     | **Dependency / scope**                                               |
|------------------------------------|----------------------------------------------------------------------|
| students.view_basic                | Scope required; basic identity and enabled guardians only            |
| students.edit                      | students.view_basic; selected/all groups scope                       |
| attendance.read / attendance.write | write implies read; Group scope                                      |
| homework.read / homework.write     | write implies read; Group scope                                      |
| exams.read / exams.write           | write implies read; Group scope                                      |
| payments.view_student_status       | students.view_basic; exposes only student obligation status in scope |
| payments.record                    | payments.view_student_status; does NOT grant finance.overview        |
| finance.overview                   | Owner or explicit grant; scoped finance data only                    |
| parent_contact                     | students.view_basic; only enabled guardians in scope                 |
| followup.read / followup.write     | write implies read; scoped cases                                     |
| reports.view / reports.export      | export implies view; group/month scope honored                       |
| groups.view / groups.manage        | manage implies view; manage controls group/groupmonth                |
| sessions.manage                    | groups.view; future scheduling/actions                               |
| team.manage                        | Owner-only in V1 unless explicit future policy                       |

Every backend query/action verifies workspace + active membership + permission + group scope. External Center Assistant has Selected Groups only; it cannot enumerate or infer other groups. Permission dependencies are resolved server-side at grant time and again at request time.

# 36. Audit, Concurrency, Idempotency

| **Area**         | **Mandatory implementation behavior**                                                                                                                                                                                                                   |
|------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| AuditEvent       | Required for financial write/reverse, permission change, QR reissue, attendance/exam edit after completion, withdrawal/transfer, fee/discount/waiver change, export, admin grant. Store before/after changed fields; metadata must not contain secrets. |
| Payments         | Client supplies idempotency key per confirmation; duplicate submit returns same transaction result.                                                                                                                                                     |
| Month create     | Idempotency key + transaction: month/configs/enrollments/obligations/sessions all succeed or none. Retry returns created resource.                                                                                                                      |
| Session complete | Idempotent transition guard; second completion never re-runs rules/ledger effects.                                                                                                                                                                      |
| Concurrent edits | Version/ETag optimistic concurrency on sensitive records. Conflict UX: “تم تحديث هذا السجل من مستخدم آخر. راجع أحدث البيانات قبل الحفظ.” No silent last-write-wins.                                                                                     |

# 37. Search Specification

Arabic normalization: normalize alef variants (أ/إ/آ→ا), ya/alef maqsura (ى→ي), remove tatweel and optional diacritics, normalize whitespace and digits for matching. Search supports name, Student ID, Guardian normalized phone, and exact QR. All results are filtered by workspace and scope before response; unauthorized/out-of-scope returns the same safe “لا توجد نتائج مطابقة.” response.

# 38. Reports and Exports Closure

| **V1 decision — Reports Center includes Student Report, Group Report, and Monthly Teacher Report. Approved formats: CSV UTF-8 only in V1. PDF and Excel/XLSX are explicitly deferred; no UI or API may imply their availability.** |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

| **Report**             | **Core rows/metrics**                                                                         |
|------------------------|-----------------------------------------------------------------------------------------------|
| Student Report         | sessions, attendance, homework, exam records, active attention, obligations/payments by month |
| Group Report           | roster, attendance/homework/exam aggregates, sessions completed/missing, collection status    |
| Monthly Teacher Report | groups, students, sessions, collection totals, overdue count, attention/open follow-ups       |

Each export carries month/filter context, user/role scope, and AuditEvent export.created. CSV uses Arabic headers, timezone-aware dates, EGP values, and no data outside permissions.

# 39. Reference Screen Registry — Exact 16

| **ID / Name**                             | **Route suggestion**     | **Role / month**         | **Actions / critical states / ref**                        |
|-------------------------------------------|--------------------------|--------------------------|------------------------------------------------------------|
| SCR-01 Authentication / Login             | /login                   | All; no month            | login/recovery; loading, invalid, locked; Desktop+Mobile   |
| SCR-02 Owner Onboarding                   | /onboarding              | Owner; no month          | policy/setup skip; validation/saving; Desktop+Mobile       |
| SCR-03 Action Center                      | /app                     | Owner/Assistant; current | next session/attention; empty/locked; Desktop+Mobile       |
| SCR-04 Months / New Month                 | /months/new              | Owner; target            | carry forward/preview/gate; blocked/retry; Desktop         |
| SCR-05 Groups List                        | /groups                  | Scoped; current          | search/create; empty/permission; Desktop+Mobile            |
| SCR-06 Group Details / Edit Schedule      | /groups/:id              | Scoped; current          | edit/impact preview; conflict; Desktop                     |
| SCR-07 Students Directory                 | /students                | Scoped; current          | search/QR/add; no-result; Desktop+Mobile                   |
| SCR-08 Student 360                        | /students/:id            | Scoped; selected         | timeline/guardian/obligations; no guardian; Desktop+Mobile |
| SCR-09 Session Attendance                 | /sessions/:id/attendance | Scoped; current          | bulk/QR; offline/permission; Desktop+Mobile                |
| SCR-10 Session Homework                   | /sessions/:id/homework   | Scoped; current          | all done/no homework; saving; Desktop+Mobile               |
| SCR-11 Session Exam & Review              | /sessions/:id/review     | Scoped; current          | absent/review/complete; gaps; Desktop+Mobile               |
| SCR-12 Follow-up / Needs Attention        | /follow-up               | Scoped; current/all      | WhatsApp/outcome/defer; empty; Desktop+Mobile              |
| SCR-13 Finance / Collection Queue         | /finance                 | Owner/scoped; current    | filter/contact; locked/empty; Desktop+Mobile               |
| SCR-14 Add Payment                        | /payments/new            | payments.record; context | allocation/review; overpay/error; Desktop+Mobile           |
| SCR-15 Team & Permissions                 | /team                    | Owner; no month          | invite/scope/grants; conflict; Desktop                     |
| SCR-16 Reports Center / Subscription Gate | /reports and /billing    | Scoped/Owner; selected   | CSV export/entitlement state; Desktop+Mobile               |

Routes are implementation suggestions, not a mandate. This registry is the visual reference contract; it does not supersede Business Rules.

# 40. Given / When / Then Acceptance Criteria

| **ID**                      | **Given / When / Then**                                                                                                                                |
|-----------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| AC-01 Signup                | Given a unique verified identity, When owner completes sign-up, Then one User, Workspace and Owner Membership are created and authenticated.           |
| AC-02 Duplicate identity    | Given verified email/phone already bound, When sign-up attempts it, Then no second identity/workspace is created and safe duplicate guidance appears.  |
| AC-03 Create month          | Given Active entitlement, When owner confirms a valid preview, Then all month artifacts are created once; retry returns same result.                   |
| AC-04 Group persistence     | Given Group A exists in August, When September is carried forward, Then Group A remains same group_id and a new GroupMonth is created.                 |
| AC-05 Generation            | Given Saturday/Tuesday schedule, When month has 5 Saturdays, Then exactly 5 Saturday occurrences plus valid Tuesdays are generated.                    |
| AC-06 Mid-month             | Given join date 15 August, When teacher opens 10 August session, Then student is absent from roster and not marked absent.                             |
| AC-07 Proration             | Given base 60000 piastres, 3 eligible of 8 billable, When Remaining sessions selected, Then due is 22500 piastres using final half-up rounding.        |
| AC-08 Cancel/reschedule     | Given a session is rescheduled, When replacement occurs, Then original retained Rescheduled, replacement linked, and it counts once.                   |
| AC-09 Attendance/homework   | Given a student absent but homework is recorded, When session completes, Then both records persist independently.                                      |
| AC-10 Exam absent           | Given absent_from_exam selected, When review saves, Then no numeric zero is stored and low-score rule is not evaluated from zero.                      |
| AC-11 Missing records       | Given default flag False and required record missing, When Complete clicked, Then completion is blocked; No homework/Exam absent do not count missing. |
| AC-12 Attention aggregation | Given absence and homework rules qualify, When engine runs, Then one active case has multiple reasons/evidence.                                        |
| AC-13 WhatsApp outcome      | Given two enabled guardians, When teacher selects secondary guardian and saves outcome, Then ContactLog references selected guardian.                  |
| AC-14 Payment partial       | Given remaining 50000 piastres, When 20000 posted, Then status Partial and remaining 30000.                                                            |
| AC-15 Reverse               | Given posted payment, When authorized reverse with reason, Then original remains auditable and remaining recalculates.                                 |
| AC-16 Old debt              | Given August 30000 and September 60000 remaining, When payment opens, Then teacher explicitly chooses obligation; no auto allocation.                  |
| AC-17 Entitlement           | Given Expired state, When owner creates month, Then blocked; historical Student 360 still readable.                                                    |
| AC-18 Scope                 | Given center assistant scoped to Group A, When searching Group B student, Then safe no-result and no leaked existence.                                 |
| AC-19 QR reissue            | Given active QR, When reissue confirmed, Then previous token invalid and Student ID unchanged.                                                         |
| AC-20 Fee impact            | Given unpaid existing obligations, When fee change selects new enrollments only, Then existing obligations unchanged and audit records choice.         |
| AC-21 Conflict              | Given another assistant updates attendance version, When stale user saves, Then conflict message and no silent overwrite.                              |

# 41. Expanded QA Registry

| **ID** | **Scenario**                                                                       |
|--------|------------------------------------------------------------------------------------|
| QA-16  | Sign up with duplicate verified email/phone; safe error and no duplicate workspace |
| QA-17  | Two siblings share one Guardian; primary/contact flags remain independent          |
| QA-18  | QR reissue invalidates old token immediately                                       |
| QA-19  | Group identity persists across two GroupMonth configurations                       |
| QA-20  | Month has zero billable sessions; proration unavailable                            |
| QA-21  | Proration verifies piastre half-up rounding                                        |
| QA-22  | Cancelled and rescheduled sessions counted correctly                               |
| QA-23  | Fee impact preview never changes paid/partial obligation silently                  |
| QA-24  | Exercise every Subscription Matrix action by entitlement state                     |
| QA-25  | Permission dependency: payments.record never grants finance.overview               |
| QA-26  | Out-of-scope Arabic/phone/QR search has no data leakage                            |
| QA-27  | Contact secondary guardian and verify ContactLog                                   |
| QA-28  | Session optimistic concurrency conflict                                            |
| QA-29  | Create month retry produces no duplicate sessions/obligations                      |
| QA-30  | CSV export honors group/month scope and logs audit                                 |

# 42. Scope Confirmation

| **In Teacher V1**                                                                                                                                              | **Explicitly Deferred**                                                                                                                                                              |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| authentication/onboarding, groups/groupmonth, sessions, students/guardians/enrollments, attention/follow-up, finance, assistant RBAC, entitlement, CSV reports | Center Workspace/subscriptions, Parent Portal, Student login, LMS, AI recommendations, WhatsApp API automation, legal accounting, overpayment credits, advanced BI, PDF/XLSX exports |

# 43. Glossary

| **Term**                  | **Definition**                                 |
|---------------------------|------------------------------------------------|
| Workspace                 | معزل بيانات المعلم ومالك الصلاحيات.            |
| Operating Month           | دورة تشغيل شهرية داخل Workspace.               |
| Group                     | هوية المجموعة الثابتة عبر الشهور.              |
| GroupMonth                | إعدادات المجموعة التشغيلية لشهر محدد.          |
| Student                   | هوية الطالب الدائمة.                           |
| Guardian                  | ولي أمر قابل للمشاركة بين الطلاب.              |
| Enrollment                | تسجيل الطالب في GroupMonth.                    |
| Session                   | موعد/حدث حصة تشغيلي.                           |
| SessionRecord             | حضور/واجب/اختبار لطالب في حصة.                 |
| Financial Obligation      | استحقاق مالي مستقل لـEnrollment.               |
| Payment                   | قيد تحصيل مرتبط باستحقاق.                      |
| Attention Case            | حالة متابعة موحدة نشطة للطالب.                 |
| Follow-up                 | إجراء/موعد متابعة ناتج عن الحالة أو التواصل.   |
| External Center Assistant | مساعد مدعو من المعلم ومقيد بمجموعات مختارة.    |
| Scope                     | حدود الكيانات/المجموعات المسموح بها.           |
| Permission                | قدرة ذرية مصرح بها.                            |
| Entitlement               | قرار قابلية تنفيذ capability حسب الاشتراك/منح. |

# 44. Open Questions and Definition of Ready

| **Priority** | **Question / boundary**                                      | **Status**                                                                       |
|--------------|--------------------------------------------------------------|----------------------------------------------------------------------------------|
| P1           | exam.low threshold per group and mathematical exam.drop rule | exam_drop_rule disabled by default; configure threshold before enabling low rule |
| P1           | Durable offline queue architecture                           | No offline save claim until decided                                              |
| P2           | PDF/XLSX export and advanced report formatting               | Deferred from V1                                                                 |

| **Definition of Ready — لا تُرفع الحالة إلى Approved for Technical Architecture & Implementation Planning إلا عند: P0=0، اعتماد Data Model وEntitlement Matrix وPermission Catalog و16 Screen Registry، توفر design tokens، AC للـcritical stories، تثبيت financial formulas وsession tests، واجتياز Golden Flow وQA edge cases.** |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 44. Final Product Decisions — P0 Closed

| **Status — Version: 1.1 Final. Status: Approved for Technical Architecture & Implementation Planning. هذه الوثيقة هي Product Source of Truth لـAcademic Precision — Teacher V1. لا يجوز للمطور أو Claude Code إنشاء Business Rule أو Permission أو Financial Behavior أو Entity Relationship غير معرّف هنا. أي تغيير جوهري يتطلب PRD Change Request / Addendum قبل التنفيذ.** |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 44.1 Authentication — Final

| **Area**               | **Final requirement**                                                                                                                                     |
|------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| Primary authentication | Email + Password only. Phone is optional profile/contact data and is not an authentication method.                                                        |
| Verification           | Email verification is mandatory after account creation. Workspace is Pending Verification until verified; only resend/verification actions are available. |
| Password               | Strong policy; secure provider-backed hashing; plaintext storage prohibited. Hash algorithm/provider selection is an Architecture ADR.                    |
| Login                  | Email + Password.                                                                                                                                         |
| Forgot password        | Email reset with generic response that does not reveal account existence.                                                                                 |
| Sessions               | Secure server-side or provider-backed session; Logout current session required. Logout all sessions is deferred.                                          |
| Deferred               | Phone OTP, social login, SSO.                                                                                                                             |

# 44.2 Subscription, Trial, Billing — Final

| **Area**                 | **Final requirement**                                                                                                                                                                                                  |
|--------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| States                   | Trial, Active, Expiring, Expired, Payment Failed, Cancelled at Period End. No Grace Period in V1.                                                                                                                      |
| Trial                    | 14 days from first Teacher Owner workspace activation; no card required; one ordinary trial per workspace/owner; complete core operational flows allowed.                                                              |
| Anti-abuse boundary      | Trial eligibility enforcement is Technical Architecture. Repeated trials via delete/recreate are not guaranteed; implementation may use verified identity/payment/account signals under privacy/legal rules.           |
| Expiring                 | In-app reminders at 7 days, 3 days, and 1 day.                                                                                                                                                                         |
| Expired / Payment Failed | Operational history is read-only. All operational writes listed in Entitlement Matrix are blocked. Login, historical read, reports view, billing, and renewal are allowed.                                             |
| Cancelled at period end  | Treated as Active until period_end; then transitions to Expired.                                                                                                                                                       |
| Billing provider         | Technical/Commercial ADR. Provider/backend webhook is source of truth; redirect alone never grants access; confirmation idempotent; entitlement changes server-side; successful renewal restores access automatically. |
| Entitlement              | Final capability gate; it is not inferred from UI state or subscription label.                                                                                                                                         |

## 44.2.1 Final Entitlement Matrix

| **Capability**                | **Trial (14d)** | **Active / Expiring** | **Expired / Payment Failed** | **Cancelled before period end** |
|-------------------------------|-----------------|-----------------------|------------------------------|---------------------------------|
| Historical read / Student 360 | Allow           | Allow                 | Allow read-only              | Allow                           |
| Reports view                  | Allow           | Allow                 | Allow read-only              | Allow                           |
| CSV export                    | Allow           | Allow                 | Block                        | Allow until end                 |
| Create month / Carry forward  | Allow           | Allow                 | Block                        | Allow until end                 |
| Create/edit groups            | Allow           | Allow                 | Block                        | Allow until end                 |
| Add/enroll students           | Allow           | Allow                 | Block                        | Allow until end                 |
| Start/complete sessions       | Allow           | Allow                 | Block                        | Allow until end                 |
| Record payments               | Allow           | Allow                 | Block                        | Allow until end                 |
| Guardian operational contact  | Allow           | Allow                 | Block                        | Allow until end                 |
| Team/permissions writes       | Allow           | Allow                 | Block                        | Allow until end                 |
| Billing/settings              | Allow           | Allow                 | Allow                        | Allow                           |

# 44.3 Privacy, Retention, Consent — Product Baseline

- Account Deletion Workflow: Requested → Pending Retention Window → Anonymized/Deleted where permitted → Completed. No immediate hard delete for records retained for integrity, security, fraud, audit, or financial history.

- Default retention baseline: academic operational and follow-up/contact records for workspace lifetime + 90 days after deletion request; audit/security events minimum 12 months; financial ledger/payment records 5 years or longer if Legal Review requires; auth/session logs follow provider/security minimum-necessary policy.

- Final retention periods MUST be validated by legal/privacy review before Production Launch. This is a release gate, not an unresolved product decision.

- Data minimization: National ID is not collected; Student records contain only operational basics, Student ID, and Guardian relations.

- Before first operational use, link/display Privacy Notice and Terms. Teacher Owner is informed that they are responsible for lawful entry/use of student and guardian data.

- Owner can archive Student and withdraw Enrollment. Ordinary UI cannot hard-delete operational/financial history. Personal/workspace export and deletion/anonymization may be Admin-assisted in V1.

- Security baseline: least privilege, server-side authorization, encryption in transit, protected storage at rest, masking when unnecessary, audit for sensitive actions, and secrets never in logs.

# 45. Reports and Export Contract

| **Included in V1 — Student Report, Group Report, Monthly Teacher Report, and CSV UTF-8 export only. PDF, XLSX/Excel, and advanced BI are explicitly deferred. Every CTA and acceptance test must say CSV, not generic “Export”.** |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 46. Final Open Questions Classification

| **Priority** | **Item**                                                                 | **Implementation boundary**                                                      |
|--------------|--------------------------------------------------------------------------|----------------------------------------------------------------------------------|
| P0           | 0                                                                        | No P0 product decisions remain.                                                  |
| P1           | exam.low threshold per GroupMonth                                        | Rule remains disabled until threshold is configured; no product-flow block.      |
| P1           | exam_drop_rule mathematical definition                                   | Feature flag disabled by default.                                                |
| P1           | durable offline queue implementation                                     | No “saved” claim before server confirmation; architecture decides durable queue. |
| P2           | PDF/XLSX, advanced reports, Phone OTP, Center Product, Parent Portal, AI | Explicitly deferred from Teacher V1.                                             |
| Release Gate | Legal/privacy validation of the defined baseline                         | Required before Production Launch; does not block Technical Architecture.        |

# 47. Definition of Ready — CLOSED

| **Teacher V1 Product Definition: CLOSED — P0 Open Questions = 0; Canonical Data Model, Entitlement Matrix, Permission Catalog, and 16 Screen Registry are final; critical AC, financial/session rules, and QA registry are defined. Ready for: Technical Architecture, ADRs, database schema, API/backend contract, authentication provider selection, billing provider selection, infrastructure/security architecture, and Claude Code handoff. This modification does not begin Center Product, implementation code, new features, or visual redesign.** |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
