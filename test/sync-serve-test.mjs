// sync-serve-test.mjs — robust full-log serve (flaky-network resilience).
// Run: npx tsx test/sync-serve-test.mjs
//
// The serve path is what a peer gets when it sends SYNC_REQ. On a real mobile
// device the network is flaky and publishSealed() throws when the node isn't
// settled. serveLog() must NEVER abort the serve or throw on a per-event
// publish failure — that's the property under test. A regression here = "peer
// joins, gets a partial log, and the app logs unhandled rejections".

import { serveLog } from "../src/sync-serve.ts";

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const ev = (id) => ({ id, hlc: { wall: 0, ctr: 0, dev: "d" }, type: "form.publish", payload: { id } });
const log = [ev("e1"), ev("e2"), ev("e3"), ev("e4"), ev("e5")];

// ── 1. happy path: serves every event, in order ──────────────────────────────
console.log("\n── happy path ──");
{
  const seen = [];
  const res = await serveLog(log, async (e) => { seen.push(e.id); });
  assert(res.total === 5, "total = log length");
  assert(res.served === 5, "all served");
  assert(res.failed === 0, "none failed");
  assert(JSON.stringify(seen) === JSON.stringify(["e1", "e2", "e3", "e4", "e5"]), "served in log order");
}

// ── 2. one publish fails → serve continues, rest still delivered ─────────────
console.log("\n── one failure mid-serve ──");
{
  const seen = [];
  const res = await serveLog(log, async (e) => {
    if (e.id === "e3") throw new Error("node-null"); // flaky: this one fails
    seen.push(e.id);
  });
  assert(res.served === 4, "4 served (e3 failed)");
  assert(res.failed === 1, "1 failed");
  assert(!seen.includes("e3"), "failed event not marked served");
  assert(seen.includes("e4") && seen.includes("e5"), "serve CONTINUED past the failure (e4, e5 delivered)");
}

// ── 3. ALL publishes fail → no throw, all counted as failed ──────────────────
console.log("\n── all fail (node down) ──");
{
  let threw = false;
  let res = null;
  try {
    res = await serveLog(log, async () => { throw new Error("node-null"); });
  } catch { threw = true; }
  assert(!threw, "serveLog never throws, even when every publish fails");
  assert(res.served === 0, "0 served");
  assert(res.failed === 5, "all 5 counted as failed");
}

// ── 4. empty log → no-op, no throw ───────────────────────────────────────────
console.log("\n── empty log ──");
{
  let called = 0;
  const res = await serveLog([], async () => { called++; });
  assert(res.total === 0 && res.served === 0 && res.failed === 0, "empty log → zero summary");
  assert(called === 0, "publish fn never called for empty log");
}

// ── 5. interleaved failures → exact served/failed accounting ─────────────────
console.log("\n── interleaved failures ──");
{
  const seen = [];
  // fail e2 and e4
  const res = await serveLog(log, async (e) => {
    if (e.id === "e2" || e.id === "e4") throw new Error("flaky");
    seen.push(e.id);
  });
  assert(res.served === 3 && res.failed === 2, "served=3 failed=2");
  assert(JSON.stringify(seen) === JSON.stringify(["e1", "e3", "e5"]), "exactly the non-failing events served, in order");
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}\n`);

if (failed > 0) process.exit(1);
