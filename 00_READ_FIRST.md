# Academic Precision — Teacher V1
## 00_READ_FIRST — Claude Code Execution Authority

**Status:** Mandatory / Read before any code change  
**Scope:** Academic Precision — Teacher V1 only  
**Purpose:** Make the repository self-contained so a fresh Claude Code session can continue implementation without relying on chat history or undocumented assumptions.

---

## 1. Mandatory reading order

Before planning or editing code, read these files **in this exact order**:

1. `docs/01_PRD_V1.1_FINAL.md`
2. `docs/02_TECHNICAL_ARCHITECTURE_V1.0_APPROVED.md`
3. `docs/03_DATABASE_SCHEMA_V1.0_APPROVED.md`
4. `docs/04_API_CONTRACT_V1.0_APPROVED.md`
5. `docs/05_IMPLEMENTATION_PLAN_AND_HANDOFF_V1.0_APPROVED.md`
6. `06_MASTER_CLAUDE_CODE_PROMPT.md`
7. The prompt for the currently authorized phase, beginning with `07_PHASE_0_PROMPT.md`.

Do not start implementation before reading the relevant sections of all governing documents.

---

## 2. Source-of-truth hierarchy

When sources appear to conflict, do **not** silently reconcile them. Apply the following authority order:

### Product/business authority
1. Business Rules in the PRD
2. Canonical Data Model
3. State Machines
4. Permissions Matrix / Permission Catalog
5. Acceptance Criteria
6. UI/UX Contract
7. Reference Screens

### Engineering authority
- The **PRD** defines what the product must do.
- **Technical Architecture v1.0 Approved** defines how the system is architected and which major technology decisions are fixed.
- **Database Schema v1.0 Approved** defines persistence, relationships, constraints, indexes, RLS boundaries, transaction boundaries and migrations.
- **API Contract v1.0 Approved** defines the stable server boundary, commands, DTOs, errors, permissions, entitlement checks, idempotency and concurrency semantics.
- **Implementation Plan & Claude Code Handoff v1.0 Approved** defines execution order, phase gates, testing expectations and completion reporting.

A lower-level document may add implementation detail, but it may not override a higher-level rule.

If a real contradiction remains after applying this hierarchy, stop and report:

`BLOCKED — SOURCE CONFLICT REQUIRES DECISION`

Include the exact conflicting sections and do not invent a resolution.

---

## 3. Non-negotiable product boundaries

Academic Precision is a **global, scalable SaaS product**, not a one-off project. Teacher V1 is the current product scope, while the architecture must remain compatible with future Center workspaces without implementing the Center Product now.

Do not introduce features outside Teacher V1. Explicitly deferred items include, among others: Center Product behavior, Parent Portal, Student login, LMS, AI recommendations, automatic WhatsApp messaging, legal accounting, overpayment credit balances, advanced BI, PDF/XLSX reports and Phone OTP.

Do not assume `Workspace = Teacher forever`; Teacher V1 uses the teacher workspace today, while future workspace types must remain architecturally possible.

---

## 4. Non-negotiable engineering rules

Never:

- put core business logic inside React components or thin controllers;
- access business tables directly from the frontend for core workflows;
- trust client-supplied `workspace_id`, user identity, role, permission or entitlement as authority;
- use frontend visibility as security;
- duplicate a Student per month;
- duplicate a Group per month;
- store guardian phone as the canonical Student relationship;
- use floating-point numbers for money;
- hard-delete financial or operational history through ordinary product flows;
- silently allocate a payment across obligations;
- silently overwrite concurrent edits;
- store raw QR credentials when the approved schema requires a hash;
- bypass idempotency on critical commands;
- bypass AuditEvent requirements for sensitive operations;
- change approved schema/API/business behavior without updating the governing source through the proper change process;
- start a later implementation phase before the current phase passes its Review Gate.

---

## 5. Mandatory implementation behavior

For every authorized task:

1. Identify the governing PRD rule and affected modules.
2. Identify database impact.
3. Identify API impact.
4. Identify permission + scope impact.
5. Identify entitlement impact when applicable.
6. Identify audit requirements.
7. Identify concurrency/idempotency requirements.
8. Identify tests required by the PRD, DB contract, API contract and current phase.
9. Implement only the authorized scope.
10. Run the required checks.
11. Produce a completion report and stop at the phase gate.

If a requested behavior has no governing product decision, stop and report:

`BLOCKED — PRODUCT DECISION REQUIRED`

Do not fill the gap from personal preference or generic best practice.

---

## 6. Current authorized execution state

The product-definition package is closed and approved for implementation planning:

- PRD V1.1 Final — approved
- Technical Architecture v1.0 — approved
- Database Schema v1.0 — approved
- API Contract v1.0 — approved
- Implementation Plan & Claude Code Handoff v1.0 — approved

**Current implementation authorization:** `Phase 0 — Repository & Foundation` only.

Do not begin Phase 1 until Phase 0 has been reviewed and explicitly approved.

---

## 7. Completion report format

At the end of every phase/task, return:

```text
PHASE/TASK:
STATUS: COMPLETE | PARTIAL | BLOCKED

IMPLEMENTED:
- ...

FILES CHANGED:
- ...

MIGRATIONS:
- none | ...

API CONTRACT CHANGES:
- none | ...

SECURITY / AUTHORIZATION IMPACT:
- ...

TESTS RUN:
- command — result

ACCEPTANCE / REVIEW GATE:
- PASS/FAIL — item

KNOWN ISSUES / DEVIATIONS:
- none | ...

BLOCKERS / DECISIONS REQUIRED:
- none | ...

NEXT RECOMMENDED ACTION:
- ...
```

A phase is not complete because code was generated. It is complete only when its approved Definition of Done and Review Gate pass.
