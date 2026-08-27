#!/usr/bin/env node
/**
 * Rasid — STAGING-ONLY mixed-workload load-test harness.
 *
 * Zero external dependencies. Uses only Node built-ins (node:https, global
 * fetch, performance). Mirrors the connection strategy already proven in
 * tooling/load-generator: a fresh HTTP connection per request by default so
 * Railway's load balancer distributes work across replicas, with an opt-in
 * keep-alive mode.
 *
 * WHAT IT DOES
 *   - Logs in ONCE via Supabase password grant, reuses the access token, and
 *     transparently re-mints it on a 401.
 *   - Drives a weighted mix of READ endpoints (dashboard / notifications /
 *     students weighted heavier) under configurable concurrency (virtual
 *     users), duration, and per-VU think-time.
 *   - Optionally (OFF by default) exercises WRITE endpoints against a single
 *     ISOLATED fixture session id — never a shared read fixture.
 *   - Runs either a single --vus level or a concurrency ladder.
 *   - Writes JSON + CSV summaries to ./results/ (gitignored).
 *
 * SAFETY (by design)
 *   - STAGING ONLY. Refuses to run unless LOAD_TEST_API_URL matches the
 *     staging allowlist (host contains "staging" or "localhost"), unless the
 *     operator sets LOAD_TEST_ALLOW_UNSAFE=1 to explicitly override. No
 *     production URL is ever hardcoded.
 *   - All credentials come from the environment only (see .env.example).
 *   - Writes require an explicit LOAD_TEST_WRITE_SESSION_ID AND --writes=on.
 *   - Graceful SIGINT: stops issuing new requests, drains in-flight ones,
 *     writes whatever results it has, and exits without hanging.
 *
 * USAGE
 *   node load-test.mjs --ladder                 # 25,50,100,150,200 VU ladder
 *   node load-test.mjs --vus 100 --duration 60s
 *   node load-test.mjs --vus 50 --think-ms 250 --duration 30s
 *   node load-test.mjs --writes on --vus 20 --duration 20s
 *
 * See README.md for the full env-var table and Railway in-region run steps.
 */

import https from "node:https";
import http from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, "results");

// ---------------------------------------------------------------------------
// 1) Configuration — env + CLI args
// ---------------------------------------------------------------------------

const ENV = {
  apiUrl: (process.env.LOAD_TEST_API_URL || "").trim().replace(/\/+$/, ""),
  supabaseUrl: (process.env.LOAD_TEST_SUPABASE_URL || "").trim().replace(/\/+$/, ""),
  supabaseKey: (process.env.LOAD_TEST_SUPABASE_KEY || "").trim(),
  email: (process.env.LOAD_TEST_EMAIL || "").trim(),
  password: process.env.LOAD_TEST_PASSWORD || "",
  workspaceId: (process.env.LOAD_TEST_WORKSPACE_ID || "").trim(),
  writeSessionId: (process.env.LOAD_TEST_WRITE_SESSION_ID || "").trim(),
  allowUnsafe: process.env.LOAD_TEST_ALLOW_UNSAFE === "1",
};

/** Parse `--flag value`, `--flag=value`, and bare boolean `--flag`. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    const eq = tok.indexOf("=");
    if (eq !== -1) {
      out[tok.slice(2, eq)] = tok.slice(eq + 1);
    } else {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true; // bare boolean flag
      }
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

/** Parse a duration like "30s", "2m", or a bare seconds number → milliseconds. */
function parseDuration(v, fallbackMs) {
  if (v == null || v === true) return fallbackMs;
  const s = String(v).trim().toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (!m) return fallbackMs;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case "ms": return n;
    case "m": return n * 60_000;
    case "h": return n * 3_600_000;
    case "s":
    default: return n * 1000;
  }
}

const CONFIG = {
  // Concurrency: a ladder OR a single VU count.
  ladder: args.ladder != null,
  ladderStages: String(args.stages || "25,50,100,150,200")
    .split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0),
  vus: parseInt(args.vus || "50", 10),
  durationMs: parseDuration(args.duration, 30_000),
  thinkMs: parseInt(args["think-ms"] != null ? args["think-ms"] : "100", 10),
  // Writes: OFF unless explicitly "on"/"true".
  writesOn: ["on", "true", "1", "yes"].includes(String(args.writes || "off").toLowerCase()),
  keepAlive: ["on", "true", "1"].includes(String(args["keep-alive"] || "off").toLowerCase()),
  requestTimeoutMs: parseInt(args["timeout-ms"] || "30000", 10),
};

// ---------------------------------------------------------------------------
// 2) Safety guardrails — refuse production, require credentials
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error(`\n[load-test] ERROR: ${msg}\n`);
  process.exit(1);
}

/** A target is allowed only if its host looks like staging/localhost, or the
 *  operator has explicitly opted into the unsafe override. */
function assertStagingTarget(rawUrl) {
  if (!rawUrl) {
    fail(
      "LOAD_TEST_API_URL is not set. This harness is staging-only and will not run " +
      "without an explicit staging target. See .env.example.",
    );
  }
  let host;
  try {
    host = new URL(rawUrl).host.toLowerCase();
  } catch {
    fail(`LOAD_TEST_API_URL is not a valid URL: "${rawUrl}"`);
  }
  const looksStaging = host.includes("staging") || host.includes("localhost") || host.startsWith("127.0.0.1");
  if (!looksStaging && !ENV.allowUnsafe) {
    fail(
      `Refusing to target "${host}". This harness only runs against hosts whose name ` +
      `contains "staging" or "localhost". If this really is a non-production target, ` +
      `re-run with LOAD_TEST_ALLOW_UNSAFE=1 to override (use with extreme care — ` +
      `NEVER point this at production).`,
    );
  }
  if (!looksStaging && ENV.allowUnsafe) {
    console.warn(
      `[load-test] WARNING: LOAD_TEST_ALLOW_UNSAFE=1 — targeting non-staging host "${host}". ` +
      `You are responsible for ensuring this is NOT production.`,
    );
  }
}

function assertCredentials() {
  const missing = [];
  if (!ENV.supabaseUrl) missing.push("LOAD_TEST_SUPABASE_URL");
  if (!ENV.supabaseKey) missing.push("LOAD_TEST_SUPABASE_KEY");
  if (!ENV.email) missing.push("LOAD_TEST_EMAIL");
  if (!ENV.password) missing.push("LOAD_TEST_PASSWORD");
  if (!ENV.workspaceId) missing.push("LOAD_TEST_WORKSPACE_ID");
  if (missing.length) {
    fail(`Missing required env var(s): ${missing.join(", ")}. See .env.example.`);
  }
  if (CONFIG.writesOn && !ENV.writeSessionId) {
    fail(
      "Writes are enabled (--writes=on) but LOAD_TEST_WRITE_SESSION_ID is not set. " +
      "Writes require an explicit ISOLATED fixture session id and will never touch " +
      "shared read fixtures.",
    );
  }
}

// ---------------------------------------------------------------------------
// 3) Auth — one token, reused, re-minted on 401
// ---------------------------------------------------------------------------

let ACCESS_TOKEN = null;
let tokenRefreshInFlight = null;

async function mintToken() {
  const res = await fetch(`${ENV.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ENV.supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: ENV.email, password: ENV.password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Supabase token grant failed (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return data.access_token;
}

/** Refresh the shared token, coalescing concurrent refreshers into one call. */
async function refreshToken() {
  if (!tokenRefreshInFlight) {
    tokenRefreshInFlight = mintToken()
      .then((t) => { ACCESS_TOKEN = t; return t; })
      .finally(() => { tokenRefreshInFlight = null; });
  }
  return tokenRefreshInFlight;
}

// ---------------------------------------------------------------------------
// 4) HTTP request primitive (node:https/http, per-request or keep-alive)
// ---------------------------------------------------------------------------

const parsedApi = ENV.apiUrl ? new URL(ENV.apiUrl) : null;
const isHttps = parsedApi ? parsedApi.protocol === "https:" : true;
const transport = isHttps ? https : http;

const agent = new (isHttps ? https.Agent : http.Agent)({
  keepAlive: CONFIG.keepAlive,
  maxSockets: CONFIG.keepAlive ? 1024 : Infinity,
});

/**
 * Issue one API request. Returns { ms, status, ok, body? }.
 * `path` is relative to /api/v1 (e.g. "/students?limit=30").
 * Network/timeout errors resolve with status 0 (never reject).
 */
function apiRequest({ method = "GET", path, token, body }) {
  const basePath = (parsedApi.pathname || "").replace(/\/$/, "");
  const fullPath = `${basePath}/api/v1${path}`;
  const payload = body != null ? JSON.stringify(body) : null;
  const start = performance.now();

  return new Promise((resolve) => {
    const req = transport.request(
      {
        host: parsedApi.hostname,
        port: parsedApi.port || (isHttps ? 443 : 80),
        path: fullPath,
        method,
        agent,
        timeout: CONFIG.requestTimeoutMs,
        headers: {
          authorization: `Bearer ${token}`,
          "x-workspace-id": ENV.workspaceId,
          accept: "application/json",
          ...(payload
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        // Only buffer the body when we might need it (non-2xx or a write that
        // returns state we reuse). For hot read paths, drain and discard.
        const wantBody = method !== "GET" || res.statusCode >= 400;
        res.on("data", (c) => { if (wantBody) chunks.push(c); });
        res.on("end", () => {
          const ms = performance.now() - start;
          let parsed;
          if (wantBody && chunks.length) {
            try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* ignore */ }
          }
          resolve({ ms, status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, body: parsed });
        });
      },
    );
    req.on("timeout", () => { req.destroy(); resolve({ ms: performance.now() - start, status: 0, ok: false }); });
    req.on("error", () => resolve({ ms: performance.now() - start, status: 0, ok: false }));
    if (payload) req.write(payload);
    req.end();
  });
}

/** Request wrapper that re-mints the token once on a 401 and retries. */
async function apiRequestAuthed(spec) {
  let res = await apiRequest({ ...spec, token: ACCESS_TOKEN });
  if (res.status === 401) {
    await refreshToken();
    res = await apiRequest({ ...spec, token: ACCESS_TOKEN });
  }
  return res;
}

// ---------------------------------------------------------------------------
// 5) Workload definition — weighted read mix
// ---------------------------------------------------------------------------

/**
 * Weighted read endpoints. Higher weight = picked more often. Dashboard-style
 * surfaces (action-center / notifications / context) and students are weighted
 * heavier to mirror real teacher usage.
 */
const READ_MIX = [
  { name: "action-center", weight: 5, path: "/action-center" },
  { name: "notifications", weight: 5, path: "/notifications" },
  { name: "students", weight: 5, path: "/students?limit=30" },
  { name: "context", weight: 4, path: `/me/workspaces/${ENV.workspaceId}/context` },
  { name: "me", weight: 2, path: "/me" },
  { name: "groups", weight: 3, path: "/groups" },
  { name: "attention-cases", weight: 3, path: "/attention-cases?limit=50" },
  { name: "finance-summary", weight: 2, path: "/finance/summary" },
  { name: "finance-collection-queue", weight: 2, path: "/finance/collection-queue" },
  { name: "sessions", weight: 3, path: "/sessions?limit=50" },
];

// Precompute a cumulative-weight table for O(log n) weighted picking.
const TOTAL_WEIGHT = READ_MIX.reduce((s, e) => s + e.weight, 0);
const CUMULATIVE = [];
{
  let acc = 0;
  for (const e of READ_MIX) { acc += e.weight; CUMULATIVE.push({ ...e, cum: acc }); }
}
function pickRead() {
  const r = Math.random() * TOTAL_WEIGHT;
  for (const e of CUMULATIVE) if (r < e.cum) return e;
  return CUMULATIVE[CUMULATIVE.length - 1];
}

// ---------------------------------------------------------------------------
// 6) Write workload (isolated fixture, opt-in only)
// ---------------------------------------------------------------------------

/**
 * Fetch the current roster for the fixture session to obtain the enrollment
 * ids and the current session version. Returns null on failure so the caller
 * can disable writes gracefully.
 */
async function loadWriteFixture() {
  const sid = ENV.writeSessionId;
  const res = await apiRequestAuthed({ method: "GET", path: `/sessions/${sid}/roster` });
  if (!res.ok || !res.body || !Array.isArray(res.body.students)) {
    console.warn(
      `[load-test] Could not load write fixture roster (HTTP ${res.status}). ` +
      `Ensure LOAD_TEST_WRITE_SESSION_ID points at a started/in-progress isolated ` +
      `session. Disabling writes for this run.`,
    );
    return null;
  }
  const enrollmentIds = res.body.students.map((s) => s.enrollmentId).filter(Boolean);
  const version = res.body.session?.version;
  if (!enrollmentIds.length || typeof version !== "number") {
    console.warn("[load-test] Write fixture roster is empty or missing version. Disabling writes.");
    return null;
  }
  // Shared mutable version — writes must send the current sessionVersion and
  // the API returns the incremented version on success (optimistic locking).
  return { sid, enrollmentIds, version };
}

/**
 * Perform one write against the fixture, alternating attendance/homework.
 * Sends the whole roster each time (mirrors the real atomic-batch DTO). Keeps
 * `fixture.version` in sync from the response to satisfy optimistic locking.
 */
async function doWrite(fixture, i) {
  const isAttendance = i % 2 === 0;
  const path = `/sessions/${fixture.sid}/${isAttendance ? "attendance" : "homework"}`;
  const records = fixture.enrollmentIds.map((enrollmentId) => ({
    enrollmentId,
    status: isAttendance ? "PRESENT" : "DONE",
  }));
  const res = await apiRequestAuthed({
    method: "PUT",
    path,
    body: { sessionVersion: fixture.version, records },
  });
  // Keep the version fresh from the response envelope when the API returns it.
  if (res.ok && res.body && typeof res.body.sessionVersion === "number") {
    fixture.version = res.body.sessionVersion;
  } else if (res.status === 409 && res.body && typeof res.body.currentVersion === "number") {
    // Version conflict: adopt the server's current version and move on.
    fixture.version = res.body.currentVersion;
  }
  return { res, label: isAttendance ? "attendance" : "homework" };
}

// ---------------------------------------------------------------------------
// 7) Stats
// ---------------------------------------------------------------------------

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return Math.round(sortedAsc[Math.max(0, idx)]);
}

function summarize(profileLabel, samples, wallMs) {
  const oks = samples.filter((s) => s.ok);
  const latencies = oks.map((s) => s.ms).sort((a, b) => a - b);
  const statusBreakdown = {};
  for (const s of samples) {
    const key = s.status === 0 ? "net_err" : String(s.status);
    statusBreakdown[key] = (statusBreakdown[key] || 0) + 1;
  }
  const nonOk = {};
  for (const s of samples) {
    if (!s.ok) {
      const key = s.status === 0 ? "net_err" : String(s.status);
      nonOk[key] = (nonOk[key] || 0) + 1;
    }
  }
  const total = samples.length;
  return {
    profile: profileLabel,
    totalRequests: total,
    wallMs: Math.round(wallMs),
    rps: wallMs > 0 ? Math.round((total / (wallMs / 1000)) * 10) / 10 : 0,
    okRequests: oks.length,
    errorCount: total - oks.length,
    p50: percentile(latencies, 50),
    p90: percentile(latencies, 90),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    statusBreakdown,
    nonOkBreakdown: nonOk,
  };
}

// ---------------------------------------------------------------------------
// 8) Runner — one profile (concurrency level) for the configured duration
// ---------------------------------------------------------------------------

let STOP = false; // flipped by SIGINT

function sleep(ms) {
  return new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });
}

/**
 * Run `vus` concurrent virtual users for `durationMs`. Each VU loops: issue a
 * request (read, or a write if writes are enabled and a fixture exists), record
 * the sample, then think for `thinkMs` before the next.
 */
async function runProfile(vus, writeFixture) {
  const samples = [];
  const deadline = performance.now() + CONFIG.durationMs;
  let opCounter = 0;

  async function virtualUser() {
    while (!STOP && performance.now() < deadline) {
      // Decide read vs write. When writes are on, ~1 in 5 ops is a write.
      const doWriteOp = writeFixture && opCounter % 5 === 4;
      const seq = opCounter++;
      let sample;
      if (doWriteOp) {
        const { res, label } = await doWrite(writeFixture, seq);
        sample = { ms: res.ms, status: res.status, ok: res.ok, endpoint: `write:${label}` };
      } else {
        const pick = pickRead();
        const res = await apiRequestAuthed({ method: "GET", path: pick.path });
        sample = { ms: res.ms, status: res.status, ok: res.ok, endpoint: pick.name };
      }
      samples.push(sample);
      if (CONFIG.thinkMs > 0 && !STOP) await sleep(CONFIG.thinkMs);
    }
  }

  const t0 = performance.now();
  await Promise.all(Array.from({ length: vus }, virtualUser));
  const wall = performance.now() - t0;
  return summarize(`vus=${vus}`, samples, wall);
}

// ---------------------------------------------------------------------------
// 9) Output — JSON + CSV to results/
// ---------------------------------------------------------------------------

function writeResults(profiles, meta) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `load-test-${stamp}`;

  const jsonPayload = {
    generatedAt: new Date().toISOString(),
    target: parsedApi.host,
    meta,
    note: "DB-side transactions/sec must be read separately (e.g. from the DB " +
      "provider's metrics). This client-side summary reports HTTP throughput and " +
      "latency only.",
    profiles,
  };
  const jsonPath = join(RESULTS_DIR, `${base}.json`);
  writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2), "utf8");

  // CSV: one row per profile with the headline metrics + flattened non-200s.
  const cols = ["profile", "totalRequests", "okRequests", "errorCount", "rps", "wallMs", "p50", "p90", "p95", "p99", "nonOk"];
  const rows = [cols.join(",")];
  for (const p of profiles) {
    const nonOk = Object.entries(p.nonOkBreakdown).map(([k, v]) => `${k}:${v}`).join(" ");
    rows.push([
      p.profile, p.totalRequests, p.okRequests, p.errorCount, p.rps, p.wallMs,
      p.p50, p.p90, p.p95, p.p99, `"${nonOk}"`,
    ].join(","));
  }
  const csvPath = join(RESULTS_DIR, `${base}.csv`);
  writeFileSync(csvPath, rows.join("\n") + "\n", "utf8");

  return { jsonPath, csvPath };
}

// ---------------------------------------------------------------------------
// 10) Main
// ---------------------------------------------------------------------------

async function main() {
  // Guardrails first — never proceed against a non-staging target or without creds.
  assertStagingTarget(ENV.apiUrl);
  assertCredentials();

  const stages = CONFIG.ladder ? CONFIG.ladderStages : [CONFIG.vus];

  console.log("[load-test] Rasid staging load test");
  console.log(`  target:      ${parsedApi.host}`);
  console.log(`  mode:        ${CONFIG.ladder ? `ladder [${stages.join(",")}]` : `single vus=${CONFIG.vus}`}`);
  console.log(`  duration:    ${CONFIG.durationMs} ms per profile`);
  console.log(`  think-ms:    ${CONFIG.thinkMs}`);
  console.log(`  keep-alive:  ${CONFIG.keepAlive}`);
  console.log(`  writes:      ${CONFIG.writesOn ? "ON" : "off"}`);
  console.log("");

  // Authenticate once.
  console.log("[load-test] Authenticating (Supabase password grant)...");
  await refreshToken();
  console.log("[load-test] Token acquired.\n");

  // Prepare the write fixture only if writes were explicitly enabled.
  let writeFixture = null;
  if (CONFIG.writesOn) {
    console.log(`[load-test] Loading isolated write fixture (session ${ENV.writeSessionId})...`);
    writeFixture = await loadWriteFixture();
    if (writeFixture) {
      console.log(`[load-test] Write fixture ready: ${writeFixture.enrollmentIds.length} enrollments, version ${writeFixture.version}.\n`);
    } else {
      console.log("[load-test] Proceeding with READS ONLY (write fixture unavailable).\n");
    }
  }

  const profiles = [];
  for (const vus of stages) {
    if (STOP) break;
    console.log(`[load-test] Running profile vus=${vus} for ${CONFIG.durationMs} ms ...`);
    const summary = await runProfile(vus, writeFixture);
    profiles.push(summary);
    console.log(
      `[load-test]   done: ${summary.totalRequests} reqs, ${summary.rps} rps, ` +
      `p50=${summary.p50}ms p95=${summary.p95}ms p99=${summary.p99}ms, ` +
      `errors=${summary.errorCount} ${JSON.stringify(summary.nonOkBreakdown)}`,
    );
    // Stop the ladder early on a clear server-side failure signal.
    const serverErrors = Object.entries(summary.nonOkBreakdown)
      .filter(([k]) => k === "net_err" || Number(k) >= 500)
      .reduce((s, [, v]) => s + v, 0);
    if (CONFIG.ladder && serverErrors > summary.totalRequests * 0.02) {
      console.log("[load-test] Server errors exceeded 2% — halting ladder early.");
      break;
    }
  }

  const meta = {
    mode: CONFIG.ladder ? "ladder" : "single",
    durationMsPerProfile: CONFIG.durationMs,
    thinkMs: CONFIG.thinkMs,
    keepAlive: CONFIG.keepAlive,
    writes: CONFIG.writesOn && writeFixture ? "on" : "off",
    stages,
  };
  const { jsonPath, csvPath } = writeResults(profiles, meta);
  console.log(`\n[load-test] Results written:\n  ${jsonPath}\n  ${csvPath}`);
  console.log("[load-test] Note: DB-side tx/sec must be read separately from the DB provider's metrics.");
}

// Graceful stop: flip STOP so VUs drain, then let main() finish its writeout.
let sigintCount = 0;
process.on("SIGINT", () => {
  sigintCount++;
  if (sigintCount === 1) {
    console.log("\n[load-test] SIGINT received — draining in-flight requests and stopping...");
    STOP = true;
  } else {
    console.log("\n[load-test] Second SIGINT — forcing exit.");
    process.exit(130);
  }
});

main().catch((err) => {
  console.error("[load-test] FATAL:", err?.stack || err?.message || err);
  process.exit(1);
});
