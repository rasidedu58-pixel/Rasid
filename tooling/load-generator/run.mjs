/**
 * Rasid Phase 15C — in-region (EU West) HTTP load generator. TEMPORARY.
 *
 * Purpose: measure the STAGING API's true concurrency ceiling from a client
 * co-located with it, removing the transatlantic home-network bottleneck
 * that capped the earlier single-remote-client runs at ~31 rps. Reuses the
 * exact Phase 15C ladder logic (node:https + uncapped agent, fresh
 * connection per request so Railway's load balancer distributes across
 * replicas; mints a fresh Supabase staging token via password grant).
 *
 * SAFETY (by design):
 * - STAGING ONLY. It refuses to run against any host containing the known
 *   production API/Supabase refs. No production credentials are ever used.
 * - IDLE BY DEFAULT. On boot it does NOTHING unless LOADTEST_ENABLED=true.
 *   With the flag off, it prints a notice and idles forever (keeps the
 *   container alive so Railway does not crash-restart it, and generates
 *   zero load). So a plain deploy/redeploy never starts a load test.
 * - RUN ONCE. When enabled it runs the ladder a single time, prints JSON
 *   results to stdout (Railway logs), then idles forever WITHOUT exiting —
 *   so Railway never restart-loops it into repeated runs. To run again:
 *   restart the service (or redeploy) with the flag still true.
 * - Zero npm dependencies (node:https + global fetch only) — nothing to
 *   build, nothing to install.
 *
 * Delete this whole folder + the Railway service after the capacity test.
 */
import https from "node:https";

// --- Hard production guardrails (never targets prod, regardless of env) ---
const PROD_MARKERS = ["sbzksiidurpofzteyxsu", "academic-precisionapi-production"];
function assertNotProduction(label, value) {
  if (!value) return;
  for (const marker of PROD_MARKERS) {
    if (value.includes(marker)) {
      console.error(`[load-generator] REFUSING TO RUN: ${label} points at production ("${marker}"). This tool is staging-only.`);
      process.exit(1);
    }
  }
}

const cfg = {
  apiUrl: (process.env.STAGING_API_URL || "").replace(/\/+$/, ""),
  supabaseUrl: (process.env.STAGING_SUPABASE_URL || "").replace(/\/+$/, ""),
  anonKey: process.env.STAGING_SUPABASE_ANON_KEY || "",
  email: process.env.LOADTEST_EMAIL || "",
  password: process.env.LOADTEST_PASSWORD || "",
  workspaceId: process.env.LOADTEST_WORKSPACE_ID || "",
  enabled: process.env.LOADTEST_ENABLED === "true",
  stages: (process.env.LOADTEST_STAGES || "25,50,100,150,200")
    .split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0),
  reqPerConc: parseInt(process.env.LOADTEST_REQUESTS_PER_CONC || "8", 10),
  paths: (process.env.LOADTEST_PATHS ||
    "/students,/me,/notifications,/groups,/finance/collection-queue,/action-center")
    .split(",").map((s) => s.trim()).filter(Boolean),
  keepAlive: process.env.LOADTEST_KEEPALIVE === "1",
};

function idleForever(reason) {
  console.log(`[load-generator] IDLE: ${reason}`);
  console.log("[load-generator] Set LOADTEST_ENABLED=true (and restart the service) to run the ladder once.");
  // Keep the container alive so Railway does not treat exit as a crash and
  // restart-loop it. Zero load is generated while idling.
  setInterval(() => {}, 1 << 30);
}

// --- Guardrails first ---
assertNotProduction("STAGING_API_URL", cfg.apiUrl);
assertNotProduction("STAGING_SUPABASE_URL", cfg.supabaseUrl);

if (!cfg.enabled) {
  idleForever("LOADTEST_ENABLED is not 'true' — no load test on this boot.");
} else {
  const missing = ["apiUrl", "supabaseUrl", "anonKey", "email", "password", "workspaceId"]
    .filter((k) => !cfg[k]);
  if (missing.length) {
    console.error(`[load-generator] Missing required env: ${missing.join(", ")}. Idling.`);
    idleForever("incomplete configuration");
  } else {
    runLadderOnceThenIdle().catch((err) => {
      console.error("[load-generator] FATAL:", err?.message || err);
      idleForever("ladder errored — see message above");
    });
  }
}

async function freshToken() {
  const r = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: cfg.email, password: cfg.password }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error("token grant failed: " + JSON.stringify(d).slice(0, 160));
  return d.access_token;
}

function makeAgent() {
  return new https.Agent({ keepAlive: cfg.keepAlive, maxSockets: cfg.keepAlive ? 512 : Infinity });
}

function oneRequest(agent, token, i) {
  const path = cfg.paths[i % cfg.paths.length];
  const t = performance.now();
  const [host, ...rest] = cfg.apiUrl.replace(/^https?:\/\//, "").split("/");
  const base = "/" + rest.join("/");
  return new Promise((resolve) => {
    const req = https.request(
      { host, path: `${base.replace(/\/$/, "")}/api/v1${path}`, method: "GET", agent, timeout: 30000,
        headers: { authorization: "Bearer " + token, "x-workspace-id": cfg.workspaceId } },
      (res) => { res.resume(); res.on("end", () => resolve({ ms: performance.now() - t, status: res.statusCode })); },
    );
    req.on("timeout", () => { req.destroy(); resolve({ ms: performance.now() - t, status: 0 }); });
    req.on("error", () => resolve({ ms: performance.now() - t, status: 0 }));
    req.end();
  });
}

async function stage(agent, token, conc, total) {
  const results = [];
  let next = 0;
  async function worker() { while (next < total) { const i = next++; results.push(await oneRequest(agent, token, i)); } }
  const t0 = performance.now();
  await Promise.all(Array.from({ length: conc }, worker));
  const wall = Math.round(performance.now() - t0);
  const ok = results.filter((r) => r.status === 200);
  const d = ok.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p) => Math.round(d[Math.min(d.length - 1, Math.ceil((p / 100) * d.length) - 1)] || 0);
  return {
    conc, total, wallMs: wall, rps: Math.round((total / (wall / 1000)) * 10) / 10,
    ok: ok.length, throttled429: results.filter((r) => r.status === 429).length,
    err5xx: results.filter((r) => r.status >= 500).length, netErr: results.filter((r) => r.status === 0).length,
    p50: pct(50), p95: pct(95), p99: pct(99),
  };
}

async function runLadderOnceThenIdle() {
  console.log("[load-generator] RUN ONCE — target:", cfg.apiUrl, "| stages:", cfg.stages.join(","),
    "| paths:", cfg.paths.length, "| keepAlive:", cfg.keepAlive);
  const agent = makeAgent();
  const out = [];
  for (const conc of cfg.stages) {
    const token = await freshToken(); // fresh per stage (staging token ~1h; cheap insurance)
    const r = await stage(agent, token, conc, conc * cfg.reqPerConc);
    out.push(r);
    console.log("[load-generator] STAGE " + JSON.stringify(r));
    // Stop early on a real server-side failure signal (not client queue).
    if (r.err5xx > 0 || r.netErr > r.total * 0.02) {
      console.log("[load-generator] STOP: server errors detected — halting ladder.");
      break;
    }
  }
  console.log("[load-generator] LADDER COMPLETE " + JSON.stringify(out));
  idleForever("ladder finished — one run only. Restart the service to run again.");
}
