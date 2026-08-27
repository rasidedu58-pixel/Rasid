/**
 * scale-seed — STAGING-ONLY deterministic scale-data seeder + cleanup tool.
 *
 * Purpose: seed large, synthetic, deterministic datasets into a STAGING
 * Postgres so dense-data regressions (query/index/load shape) can be
 * reproduced, then remove every seeded row with zero residue.
 *
 * SAFETY MODEL (read carefully):
 *   - The connection string is read ONLY from env `SCALE_SEED_DATABASE_URL`.
 *     It is never hardcoded and never falls back to any other env var. This is
 *     expected to be a PRIVILEGED / migration-level connection (it must bypass
 *     RLS to insert cross-tenant fixtures) — never the app runtime role.
 *   - It REFUSES to run unless BOTH staging signals are present:
 *       1. the host looks like a Supabase host (contains "supabase.co", which
 *          also matches the "*.pooler.supabase.com" pooler host), AND
 *       2. the operator has explicitly set env `SCALE_SEED_ALLOW=1`.
 *     A confirmation banner prints on every run so the target is never
 *     ambiguous. Never point this at production.
 *
 * OWNERSHIP / CLEANUP MODEL:
 *   Every seeded row is tagged with the marker prefix `SCALE_SEED::` on a
 *   text column (workspaces.name, users.full_name). Cleanup is therefore
 *   robust even if the local JSON manifest is lost: it re-discovers the
 *   seeded workspaces by that marker and cascades deletes in FK-safe order.
 *   A JSON manifest is ALSO written under ./manifests/ as a secondary record
 *   and for the verify report.
 *
 * DETERMINISM:
 *   Given the same `--seed <int>`, all ids and all data are reproducible.
 *   Ids are derived via sha256(seed|kind|index) formatted as UUIDv4 (no
 *   randomUUID). All "random" variety (fee tiers, paid/unpaid split) comes
 *   from a seeded, hash-based PRNG — never Math.random. All timestamps are
 *   fixed calendar constants — never Date.now (the only Date.now use is the
 *   elapsed-time progress meter, which never touches seeded data).
 *
 * This bypasses the application layer entirely (no HTTP/NestJS/business
 * rules) — bulk multi-row INSERTs, exactly like the repo's own integration
 * tests seed, just at volume. It is a data-shape generator, not a
 * functional-correctness tool.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

// Resolve `postgres` from the database package's own node_modules — this
// tooling dir is intentionally NOT a pnpm workspace package, so anchor the
// require there rather than modifying pnpm-workspace.yaml.
const require = createRequire(join(REPO_ROOT, "packages", "database", "package.json"));
/** @type {typeof import("postgres")} */
let postgres;
try {
  postgres = require("postgres");
} catch (e) {
  console.error(
    "[scale-seed] Could not resolve the 'postgres' package from packages/database.\n" +
      "Run `pnpm install` at the repo root first. Original error:\n" +
      String(e && e.message ? e.message : e),
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MARKER = "SCALE_SEED::";
const MANIFEST_DIR = join(__dirname, "manifests");

/** Fixed calendar constants — deterministic, never Date.now(). */
const OP_YEAR = 2026;
const OP_MONTH = 9; // September 2026
const JOIN_DATE = "2026-09-01";
const PAID_AT = "2026-09-15T10:00:00Z";

/** Profile presets. Every value is overridable via flags. */
const PROFILES = {
  // Tiny fixture for the operator's live dry-run (seed 2 students, clean up).
  probe: { workspaces: 1, studentsPerWorkspace: 2, groupsPerWorkspace: 1, membershipsPerWorkspace: 0, sessionsPerGroupMonth: 2 },
  // ONE workspace with 3,000 students + realistic footprint.
  "dense-3000": { workspaces: 1, studentsPerWorkspace: 3000, groupsPerWorkspace: 75, membershipsPerWorkspace: 3, sessionsPerGroupMonth: 12 },
  // N workspaces, each a small realistic footprint.
  "workspaces-100": { workspaces: 100, studentsPerWorkspace: 40, groupsPerWorkspace: 2, membershipsPerWorkspace: 1, sessionsPerGroupMonth: 8 },
  "workspaces-500": { workspaces: 500, studentsPerWorkspace: 40, groupsPerWorkspace: 2, membershipsPerWorkspace: 1, sessionsPerGroupMonth: 8 },
  "workspaces-1000": { workspaces: 1000, studentsPerWorkspace: 40, groupsPerWorkspace: 2, membershipsPerWorkspace: 1, sessionsPerGroupMonth: 8 },
};

/** Tables the seeder can write, in FK-safe DELETE order (children first). */
const CLEANUP_ORDER = [
  "payment_reversals",
  "payments",
  "financial_obligations",
  "session_records",
  "sessions",
  "enrollments",
  "students",
  "group_months",
  "operating_months",
  "groups",
  "memberships",
  // workspaces + users handled specially (workspaces by id, users by marker)
];

// ---------------------------------------------------------------------------
// Deterministic id + PRNG helpers (no randomUUID, no Math.random)
// ---------------------------------------------------------------------------

/** Deterministic UUIDv4-shaped id from (seed, kind, index). */
function detId(seed, kind, index) {
  const h = createHash("sha256").update(`${seed}|${kind}|${index}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC-4122 variant
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Deterministic float in [0,1) from (seed, kind, index) — the seeded PRNG. */
function detRand(seed, kind, index) {
  const h = createHash("sha256").update(`${seed}~${kind}~${index}`).digest();
  // 6 bytes -> integer -> normalize.
  const n = h.readUIntBE(0, 6);
  return n / 0x1000000000000;
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function intArg(args, name, fallback) {
  const v = args[name];
  if (v === undefined || v === true) return fallback;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ---------------------------------------------------------------------------
// Staging guard
// ---------------------------------------------------------------------------

function readStagingUrlOrExit() {
  const url = process.env.SCALE_SEED_DATABASE_URL;
  if (!url) {
    console.error(
      "\n[scale-seed] REFUSING TO RUN: env SCALE_SEED_DATABASE_URL is not set.\n" +
        "Set it to your STAGING (privileged/migration-level) Postgres connection string.\n",
    );
    process.exit(2);
  }
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    // postgres URLs with unusual chars may not parse via URL(); fall back to a
    // substring scan of the whole string.
    host = url;
  }
  const looksSupabase = url.includes("supabase.co"); // matches supabase.co AND *.supabase.com
  const allow = process.env.SCALE_SEED_ALLOW === "1";

  const bannerHost = host.replace(/:[^:@/]*@/, ":***@"); // redact any password
  console.log(
    "\n============================================================\n" +
      "  scale-seed — STAGING DATA SEEDER\n" +
      "============================================================\n" +
      `  Target host : ${bannerHost}\n` +
      `  Supabase host signal : ${looksSupabase ? "OK (contains supabase.co)" : "MISSING"}\n` +
      `  SCALE_SEED_ALLOW=1   : ${allow ? "OK" : "MISSING"}\n` +
      "============================================================\n",
  );

  if (!looksSupabase) {
    console.error(
      "[scale-seed] REFUSING TO RUN: the SCALE_SEED_DATABASE_URL host does not look like a\n" +
        "Supabase staging host (must contain 'supabase.co'). This guard exists to keep the\n" +
        "seeder off production and off arbitrary databases.\n",
    );
    process.exit(2);
  }
  if (!allow) {
    console.error(
      "[scale-seed] REFUSING TO RUN: env SCALE_SEED_ALLOW=1 is not set.\n" +
        "The operator must explicitly opt in by exporting SCALE_SEED_ALLOW=1 to confirm this\n" +
        "is a disposable STAGING database and NOT production.\n",
    );
    process.exit(2);
  }
  return url;
}

// ---------------------------------------------------------------------------
// Batched insert with progress
// ---------------------------------------------------------------------------

async function insertBatched(sql, table, rows, batchSize, startedAt) {
  if (rows.length === 0) {
    console.log(`[scale-seed]   ${table}: 0 rows`);
    return;
  }
  let done = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await sql`INSERT INTO ${sql(table)} ${sql(batch)}`;
    done += batch.length;
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    process.stdout.write(`\r[scale-seed]   ${table}: ${done}/${rows.length} rows (${elapsed}s)   `);
  }
  process.stdout.write("\n");
}

// ---------------------------------------------------------------------------
// SEED
// ---------------------------------------------------------------------------

async function runSeed(sql, opts) {
  const { seed, profileName, counts } = opts;
  const startedAt = Date.now();
  const runLabel = `${profileName}::s${seed}`;
  console.log(
    `[scale-seed] SEED profile="${profileName}" seed=${seed} ` +
      `workspaces=${counts.workspaces} students/ws=${counts.studentsPerWorkspace} ` +
      `groups/ws=${counts.groupsPerWorkspace} memberships/ws=${counts.membershipsPerWorkspace} ` +
      `sessions/group_month=${counts.sessionsPerGroupMonth} batch=${opts.batchSize}`,
  );

  const K = (kind) => `${runLabel}|${kind}`;
  const manifest = { marker: MARKER, profile: profileName, seed, createdAtLabel: `${OP_YEAR}-${OP_MONTH}`, counts, workspaceIds: [], userIds: [] };

  // ---- Users (owner + assistants per workspace) ----
  const owners = [];
  const members = []; // { id, workspaceIndex }
  for (let w = 0; w < counts.workspaces; w++) {
    const ownerId = detId(seed, K("owner"), w);
    owners.push({ id: ownerId, workspaceIndex: w });
    for (let m = 0; m < counts.membershipsPerWorkspace; m++) {
      members.push({ id: detId(seed, K("member"), `${w}-${m}`), workspaceIndex: w, m });
    }
  }
  const slug = runLabel.toLowerCase().replace(/[^a-z0-9]/g, "-");
  // Uniform column set across ALL rows — postgres.js bulk insert uses the
  // FIRST row's keys for the whole batch, so every user row must declare the
  // same keys (phone included, fake and clearly synthetic).
  const userRows = [
    ...owners.map((o) => ({ id: o.id, full_name: `${MARKER}${runLabel} Owner ${o.workspaceIndex}`, email_display: `${slug}-owner-${o.workspaceIndex}@scale.invalid`, phone: `+19999${String(o.workspaceIndex).padStart(6, "0")}`, status: "ACTIVE" })),
    ...members.map((mm) => ({ id: mm.id, full_name: `${MARKER}${runLabel} Member ${mm.workspaceIndex}-${mm.m}`, email_display: `${slug}-m-${mm.workspaceIndex}-${mm.m}@scale.invalid`, phone: `+18888${String(mm.workspaceIndex).padStart(4, "0")}${String(mm.m).padStart(2, "0")}`, status: "ACTIVE" })),
  ];
  console.log(`[scale-seed] inserting users (${userRows.length})...`);
  await insertBatched(sql, "users", userRows, opts.batchSize, startedAt);
  manifest.userIds = userRows.map((u) => u.id);

  // ---- Workspaces ----
  const workspaces = owners.map((o, w) => ({
    id: detId(seed, K("workspace"), w),
    owner_user_id: o.id,
    name: `${MARKER}${runLabel} Workspace ${w}`,
    workspace_type: "TEACHER",
    locale: "ar-EG",
    timezone: "Africa/Cairo",
    due_date_policy: "PER_GROUP",
    status: "ACTIVE",
  }));
  console.log(`[scale-seed] inserting workspaces (${workspaces.length})...`);
  await insertBatched(sql, "workspaces", workspaces, opts.batchSize, startedAt);
  manifest.workspaceIds = workspaces.map((w) => w.id);

  // ---- Memberships (owner + assistants) ----
  const memberships = [];
  for (let w = 0; w < workspaces.length; w++) {
    memberships.push({ id: detId(seed, K("ownermembership"), w), workspace_id: workspaces[w].id, user_id: owners[w].id, role_label: "OWNER", status: "ACTIVE", joined_at: JOIN_DATE });
  }
  for (const mm of members) {
    memberships.push({ id: detId(seed, K("membership"), `${mm.workspaceIndex}-${mm.m}`), workspace_id: workspaces[mm.workspaceIndex].id, user_id: mm.id, role_label: "ASSISTANT", status: "ACTIVE", joined_at: JOIN_DATE });
  }
  console.log(`[scale-seed] inserting memberships (${memberships.length})...`);
  await insertBatched(sql, "memberships", memberships, opts.batchSize, startedAt);

  // ---- Operating months (one CURRENT per workspace) ----
  const months = workspaces.map((ws, w) => ({ id: detId(seed, K("month"), w), workspace_id: ws.id, year: OP_YEAR, month: OP_MONTH, status: "CURRENT", created_by: owners[w].id }));
  console.log(`[scale-seed] inserting operating_months (${months.length})...`);
  await insertBatched(sql, "operating_months", months, opts.batchSize, startedAt);

  // ---- Groups ----
  const groups = [];
  for (let w = 0; w < workspaces.length; w++) {
    for (let g = 0; g < counts.groupsPerWorkspace; g++) {
      groups.push({ id: detId(seed, K("group"), `${w}-${g}`), workspaceIndex: w, workspace_id: workspaces[w].id, name: `${MARKER}${runLabel} Group ${w}-${g}`, subject: "MATH", grade: "G10", status: "ACTIVE" });
    }
  }
  const groupRows = groups.map((g) => ({ id: g.id, workspace_id: g.workspace_id, name: g.name, subject: g.subject, grade: g.grade, status: g.status }));
  console.log(`[scale-seed] inserting groups (${groupRows.length})...`);
  await insertBatched(sql, "groups", groupRows, opts.batchSize, startedAt);

  // ---- group_months (one per group, tied to that workspace's CURRENT month) ----
  const monthByWs = new Map(months.map((m) => [m.workspace_id, m]));
  const groupMonths = groups.map((g, idx) => {
    const m = monthByWs.get(g.workspace_id);
    // deterministic fee tier: 25000 / 30000 / 40000 minor units
    const r = detRand(seed, K("fee"), idx);
    const base = r < 0.5 ? 30000 : r < 0.8 ? 25000 : 40000;
    return { id: detId(seed, K("groupmonth"), idx), workspaceIndex: g.workspaceIndex, workspace_id: g.workspace_id, group_id: g.id, operating_month_id: m.id, base_fee_minor: base, currency_code: "EGP", due_policy: "PER_GROUP", due_day: 10, join_fee_policy: "FULL", monthly_status: "ACTIVE" };
  });
  const groupMonthRows = groupMonths.map((gm) => ({ id: gm.id, workspace_id: gm.workspace_id, group_id: gm.group_id, operating_month_id: gm.operating_month_id, base_fee_minor: gm.base_fee_minor, currency_code: gm.currency_code, due_policy: gm.due_policy, due_day: gm.due_day, join_fee_policy: gm.join_fee_policy, monthly_status: gm.monthly_status }));
  console.log(`[scale-seed] inserting group_months (${groupMonthRows.length})...`);
  await insertBatched(sql, "group_months", groupMonthRows, opts.batchSize, startedAt);

  // group_months grouped by workspace for round-robin enrollment.
  const gmByWs = new Map();
  for (const gm of groupMonths) {
    const list = gmByWs.get(gm.workspace_id) ?? [];
    list.push(gm);
    gmByWs.set(gm.workspace_id, list);
  }

  // ---- Students ----
  const students = [];
  for (let w = 0; w < workspaces.length; w++) {
    for (let i = 0; i < counts.studentsPerWorkspace; i++) {
      const gid = detId(seed, K("student"), `${w}-${i}`);
      students.push({ id: gid, workspaceIndex: w, workspace_id: workspaces[w].id, student_code: `SS-${seed}-${w}-${i}`, name: `${MARKER}طالب ${w}-${i}`, search_name_normalized: `talib ${w} ${i}`, status: "ACTIVE" });
    }
  }
  const studentRows = students.map((s) => ({ id: s.id, workspace_id: s.workspace_id, student_code: s.student_code, name: s.name, search_name_normalized: s.search_name_normalized, status: s.status }));
  console.log(`[scale-seed] inserting students (${studentRows.length})...`);
  await insertBatched(sql, "students", studentRows, opts.batchSize, startedAt);

  // ---- Enrollments (round-robin students across their workspace's group_months) ----
  const enrollments = students.map((st, idx) => {
    const wsGms = gmByWs.get(st.workspace_id);
    const gm = wsGms[idx % wsGms.length];
    return { id: detId(seed, K("enrollment"), idx), workspace_id: st.workspace_id, student_id: st.id, group_month_id: gm.id, base_fee_minor: gm.base_fee_minor, join_date: JOIN_DATE, status: "ACTIVE", fee_method: "FULL_MONTH" };
  });
  const enrollmentRows = enrollments.map((e) => ({ id: e.id, workspace_id: e.workspace_id, student_id: e.student_id, group_month_id: e.group_month_id, join_date: e.join_date, status: e.status, fee_method: e.fee_method }));
  console.log(`[scale-seed] inserting enrollments (${enrollmentRows.length})...`);
  await insertBatched(sql, "enrollments", enrollmentRows, opts.batchSize, startedAt);

  // enrollments grouped by group_month for session_records.
  const enrByGm = new Map();
  for (const e of enrollments) {
    const list = enrByGm.get(e.group_month_id) ?? [];
    list.push(e);
    enrByGm.set(e.group_month_id, list);
  }
  const ownerIdByWs = new Map(workspaces.map((ws, w) => [ws.id, owners[w].id]));

  // ---- Sessions + session_records (the real volume driver) ----
  let totalSessions = 0;
  let totalRecords = 0;
  const sessionsBuffer = [];
  const recordsBuffer = [];
  let recIndex = 0;
  for (let gmi = 0; gmi < groupMonths.length; gmi++) {
    const gm = groupMonths[gmi];
    const createdBy = ownerIdByWs.get(gm.workspace_id);
    const gmSessions = [];
    for (let s = 0; s < counts.sessionsPerGroupMonth; s++) {
      const day = String((s % 27) + 1).padStart(2, "0");
      gmSessions.push({ id: detId(seed, K("session"), `${gmi}-${s}`), workspace_id: gm.workspace_id, group_month_id: gm.id, scheduled_at: `${OP_YEAR}-${String(OP_MONTH).padStart(2, "0")}-${day}T08:00:00Z`, duration_minutes: 60, status: "COMPLETED", origin: "GENERATED", billable_for_proration: true, created_by: createdBy });
    }
    sessionsBuffer.push(...gmSessions);
    totalSessions += gmSessions.length;

    const gmEnrollments = enrByGm.get(gm.id) ?? [];
    for (const session of gmSessions) {
      for (const e of gmEnrollments) {
        // deterministic attendance/homework variety via seeded PRNG
        const ra = detRand(seed, K("att"), recIndex);
        const rh = detRand(seed, K("hw"), recIndex);
        const attendance = ra < 0.85 ? "PRESENT" : ra < 0.95 ? "LATE" : "ABSENT";
        const homework = rh < 0.7 ? "DONE" : rh < 0.85 ? "PARTIAL" : rh < 0.95 ? "NOT_DONE" : "NO_HOMEWORK";
        recordsBuffer.push({ id: detId(seed, K("record"), recIndex), workspace_id: gm.workspace_id, group_month_id: gm.id, session_id: session.id, enrollment_id: e.id, attendance_status: attendance, homework_status: homework, exam_status: "NO_EXAM" });
        recIndex++;
      }
    }
  }
  console.log(`[scale-seed] inserting sessions (${totalSessions})...`);
  await insertBatched(sql, "sessions", sessionsBuffer, opts.batchSize, startedAt);
  totalRecords = recordsBuffer.length;
  console.log(`[scale-seed] inserting session_records (${totalRecords})...`);
  await insertBatched(sql, "session_records", recordsBuffer, opts.batchSize, startedAt);

  // ---- Financial obligations + payments (realistic paid/partial/unpaid mix) ----
  const obligations = [];
  const payments = [];
  let payIndex = 0;
  for (let i = 0; i < enrollments.length; i++) {
    const e = enrollments[i];
    const netDue = e.base_fee_minor;
    const r = detRand(seed, K("pay"), i);
    // ~40% PAID, ~25% PARTIAL, ~35% UNPAID
    let paid;
    let status;
    if (r < 0.4) {
      paid = netDue;
      status = "PAID";
    } else if (r < 0.65) {
      paid = Math.floor(netDue / 2);
      status = "PARTIAL";
    } else {
      paid = 0;
      status = "UNPAID";
    }
    const dueDay = String((i % 27) + 1).padStart(2, "0");
    const obId = detId(seed, K("obligation"), i);
    obligations.push({ id: obId, workspace_id: e.workspace_id, enrollment_id: e.id, currency_code: "EGP", base_fee_minor: netDue, discount_minor: 0, waiver_minor: 0, net_due_minor: netDue, due_date: `${OP_YEAR}-${String(OP_MONTH).padStart(2, "0")}-${dueDay}`, amount_paid_minor: paid, remaining_minor: netDue - paid, status, calculation_basis: "FULL_MONTH" });
    if (paid > 0) {
      payments.push({ id: detId(seed, K("payment"), payIndex), workspace_id: e.workspace_id, obligation_id: obId, amount_minor: paid, currency_code: "EGP", method: "CASH", paid_at: PAID_AT, status: "POSTED", idempotency_key: `${MARKER}${runLabel}-pay-${payIndex}`, recorded_by: ownerIdByWs.get(e.workspace_id) });
      payIndex++;
    }
  }
  console.log(`[scale-seed] inserting financial_obligations (${obligations.length})...`);
  await insertBatched(sql, "financial_obligations", obligations, opts.batchSize, startedAt);
  console.log(`[scale-seed] inserting payments (${payments.length})...`);
  await insertBatched(sql, "payments", payments, opts.batchSize, startedAt);

  // ---- Write manifest ----
  mkdirSync(MANIFEST_DIR, { recursive: true });
  manifest.totals = {
    users: userRows.length,
    workspaces: workspaces.length,
    memberships: memberships.length,
    operating_months: months.length,
    groups: groupRows.length,
    group_months: groupMonthRows.length,
    students: studentRows.length,
    enrollments: enrollmentRows.length,
    sessions: totalSessions,
    session_records: totalRecords,
    financial_obligations: obligations.length,
    payments: payments.length,
  };
  const manifestPath = join(MANIFEST_DIR, `${profileName}__seed-${seed}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n[scale-seed] SEED DONE in ${elapsed}s. Totals:`);
  for (const [t, n] of Object.entries(manifest.totals)) console.log(`  ${t}: ${n}`);
  console.log(`[scale-seed] Manifest: ${manifestPath}`);
  console.log(`[scale-seed] Marker prefix for cleanup/verify: "${MARKER}"`);
}

// ---------------------------------------------------------------------------
// VERIFY — count marked rows currently present, per table.
// ---------------------------------------------------------------------------

async function markedWorkspaceIds(sql) {
  const rows = await sql`SELECT id FROM workspaces WHERE name LIKE ${MARKER + "%"}`;
  return rows.map((r) => r.id);
}

async function runVerify(sql) {
  const wsIds = await markedWorkspaceIds(sql);
  console.log(`[scale-seed] VERIFY — marked workspaces: ${wsIds.length}`);
  const report = {};
  for (const table of CLEANUP_ORDER) {
    if (wsIds.length === 0) {
      report[table] = 0;
      continue;
    }
    const rows = await sql`SELECT count(*)::int AS c FROM ${sql(table)} WHERE workspace_id = ANY(${wsIds})`;
    report[table] = rows[0].c;
  }
  report.workspaces = wsIds.length;
  const userRows = await sql`SELECT count(*)::int AS c FROM users WHERE full_name LIKE ${MARKER + "%"}`;
  report.users = userRows[0].c;

  console.log("[scale-seed] Marked rows per table:");
  for (const [t, n] of Object.entries(report)) console.log(`  ${t}: ${n}`);
  return report;
}

// ---------------------------------------------------------------------------
// CLEANUP — delete only marked rows, FK-safe, then verify zero residue.
// ---------------------------------------------------------------------------

async function runCleanup(sql) {
  const startedAt = Date.now();
  const wsIds = await markedWorkspaceIds(sql);
  console.log(`[scale-seed] CLEANUP — found ${wsIds.length} marked workspace(s).`);

  if (wsIds.length > 0) {
    for (const table of CLEANUP_ORDER) {
      const res = await sql`DELETE FROM ${sql(table)} WHERE workspace_id = ANY(${wsIds})`;
      console.log(`[scale-seed]   deleted ${res.count} from ${table}`);
    }
    const wsDel = await sql`DELETE FROM workspaces WHERE id = ANY(${wsIds})`;
    console.log(`[scale-seed]   deleted ${wsDel.count} from workspaces`);
  }
  // Users are marked by full_name (they are not workspace-scoped rows).
  const userDel = await sql`DELETE FROM users WHERE full_name LIKE ${MARKER + "%"}`;
  console.log(`[scale-seed]   deleted ${userDel.count} from users`);

  // Zero-residue verification.
  console.log("\n[scale-seed] Zero-residue verification:");
  const report = await runVerify(sql);
  const residue = Object.entries(report).filter(([, n]) => n > 0);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (residue.length === 0) {
    console.log(`[scale-seed] CLEANUP DONE in ${elapsed}s. ZERO RESIDUE confirmed (all marked counts = 0).`);
  } else {
    console.error(`[scale-seed] CLEANUP INCOMPLETE — residual marked rows remain: ${JSON.stringify(Object.fromEntries(residue))}`);
    process.exitCode = 3;
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(
    `scale-seed — STAGING-ONLY deterministic scale seeder + cleanup\n\n` +
      `Usage:\n` +
      `  node scale-seed.mjs --profile <name> [--seed <int>] [overrides]\n` +
      `  node scale-seed.mjs --verify\n` +
      `  node scale-seed.mjs --cleanup\n\n` +
      `Profiles: ${Object.keys(PROFILES).join(", ")}\n\n` +
      `Overrides (flags win over the profile preset):\n` +
      `  --workspaces <n>\n` +
      `  --students-per-workspace <n>\n` +
      `  --groups-per-workspace <n>\n` +
      `  --memberships-per-workspace <n>\n` +
      `  --sessions-per-group-month <n>\n` +
      `  --batch-size <n>            (default 1000)\n` +
      `  --seed <int>               (default 42; controls all ids + data)\n\n` +
      `Required env:\n` +
      `  SCALE_SEED_DATABASE_URL    staging (privileged) Postgres URL\n` +
      `  SCALE_SEED_ALLOW=1         explicit staging opt-in\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    return;
  }

  const url = readStagingUrlOrExit();
  const sql = postgres(url, { max: 4, prepare: !/:6543\//.test(url) });

  try {
    if (args.cleanup) {
      await runCleanup(sql);
      return;
    }
    if (args.verify) {
      await runVerify(sql);
      return;
    }

    const profileName = typeof args.profile === "string" ? args.profile : undefined;
    if (!profileName || !PROFILES[profileName]) {
      console.error(`[scale-seed] --profile is required and must be one of: ${Object.keys(PROFILES).join(", ")}`);
      printUsage();
      process.exitCode = 1;
      return;
    }
    const preset = PROFILES[profileName];
    const counts = {
      workspaces: intArg(args, "workspaces", preset.workspaces),
      studentsPerWorkspace: intArg(args, "students-per-workspace", preset.studentsPerWorkspace),
      groupsPerWorkspace: Math.max(1, intArg(args, "groups-per-workspace", preset.groupsPerWorkspace)),
      membershipsPerWorkspace: intArg(args, "memberships-per-workspace", preset.membershipsPerWorkspace),
      sessionsPerGroupMonth: intArg(args, "sessions-per-group-month", preset.sessionsPerGroupMonth),
    };
    const seed = intArg(args, "seed", 42);
    const batchSize = Math.min(1000, Math.max(1, intArg(args, "batch-size", 1000)));
    await runSeed(sql, { seed, profileName, counts, batchSize });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[scale-seed] FAILED:", err);
  process.exit(1);
});
