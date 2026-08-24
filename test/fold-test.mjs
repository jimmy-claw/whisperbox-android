// fold-test.mjs — engine fold + creator-view + HLC tests.
// Run: npx tsx test/fold-test.mjs
//
// Locks in the local-first editing behaviour (form.update) and the deterministic
// fold from event log → AppState → CreatorView. No network, no native deps.

import {
  computeState, computeCreatorView, mergeEvents, totalOrder, compareHlc, HlcClock,
} from "../src/engine.ts";
import { deriveIdentity, seal, open, pubKeyFromHex } from "../src/crypto.ts";
import { bytesToBase64 } from "../src/encoding.ts";

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── helpers ───────────────────────────────────────────────────────────────────
const hlc = (wall, ctr = 0, dev = "dev") => ({ wall, ctr, dev });
const ev = (id, type, payload, wall) => ({ id, hlc: hlc(wall), type, payload });

function makeForm(id, creator, pubHex, title, questions) {
  return {
    id, title, description: "", creator, publicKey: pubHex,
    createdAt: 0, expiresAt: null, questions,
    whitelist: { type: "none", value: "" },
  };
}

// ── 1. form.publish → feed ────────────────────────────────────────────────────
console.log("\n── form.publish ──");
{
  const alice = deriveIdentity();
  const form = makeForm("form-1", alice.address, alice.pubHex, "Survey", [{ id: "q1", type: "text", text: "Hi?", required: true }]);
  const state = computeState([ev("e1", "form.publish", form, 1000)], alice.address);
  assert(state.feed.length === 1 && state.feed[0] === "form-1", "published form appears in feed");
  assert(state.forms["form-1"].title === "Survey", "form def stored");
  assert(state.closedForms.has("form-1") === false, "not closed");
}

// ── 2. form.update → overwrite, preserve position + identity ─────────────────
console.log("\n── form.update (local-first edit) ──");
{
  const alice = deriveIdentity();
  const form = makeForm("form-1", alice.address, alice.pubHex, "Original", [{ id: "q1", type: "text", text: "A", required: true }]);
  const updated = { ...form, title: "Edited", questions: [{ id: "q1", type: "text", text: "A", required: true }, { id: "q2", type: "text", text: "B", required: false }] };

  const state = computeState([
    ev("e1", "form.publish", form, 1000),
    ev("e2", "form.update", updated, 2000),
  ], alice.address);

  assert(state.forms["form-1"].title === "Edited", "update overwrites title");
  assert(state.forms["form-1"].questions.length === 2, "update overwrites questions");
  assert(state.feed.length === 1 && state.feed[0] === "form-1", "update does NOT add a second feed entry");
  // identity fields are preserved from the original publish (can't be hijacked by an update)
  assert(state.forms["form-1"].creator === alice.address, "update preserves creator");
  assert(state.forms["form-1"].publicKey === alice.pubHex, "update preserves publicKey");
}

// ── 3. form.update on missing form → no-op ───────────────────────────────────
console.log("\n── form.update on missing form ──");
{
  const alice = deriveIdentity();
  const ghost = makeForm("form-ghost", alice.address, alice.pubHex, "Ghost", []);
  const state = computeState([ev("e1", "form.update", ghost, 1000)], alice.address);
  assert(state.feed.length === 0, "update without publish does not create a form");
  assert(state.forms["form-ghost"] === undefined, "no phantom form in forms map");
}

// ── 4. response.submit → sealed pool + dedup ─────────────────────────────────
console.log("\n── response.submit ──");
{
  const alice = deriveIdentity();
  const form = makeForm("form-1", alice.address, alice.pubHex, "S", [{ id: "q1", type: "text", text: "A", required: true }]);
  const resp = { id: "resp-1", sealed: "AAAA", from: "0xbob" };
  const state = computeState([
    ev("e1", "form.publish", form, 1000),
    ev("e2", "response.submit", resp, 2000),
    ev("e3", "response.submit", resp, 3000), // duplicate id
  ], alice.address);
  assert(state.sealedPool.length === 1, "duplicate response id deduped");
  assert(state.sealedPool[0].id === "resp-1", "sealed pool holds the response");
}

// ── 5. form.close ─────────────────────────────────────────────────────────────
console.log("\n── form.close ──");
{
  const alice = deriveIdentity();
  const form = makeForm("form-1", alice.address, alice.pubHex, "S", []);
  const state = computeState([
    ev("e1", "form.publish", form, 1000),
    ev("e2", "form.close", { formId: "form-1" }, 2000),
  ], alice.address);
  assert(state.closedForms.has("form-1"), "closed form tracked");
  assert(state.forms["form-1"] !== undefined, "form def still present after close");
}

// ── 6. feed ordering follows HLC ─────────────────────────────────────────────
console.log("\n── feed HLC ordering ──");
{
  const alice = deriveIdentity();
  const f1 = makeForm("form-b", alice.address, alice.pubHex, "B", []);
  const f2 = makeForm("form-a", alice.address, alice.pubHex, "A", []);
  // publish "b" first (earlier wall), "a" second — feed must be [b, a]
  const state = computeState([
    ev("e1", "form.publish", f1, 1000),
    ev("e2", "form.publish", f2, 2000),
  ], alice.address);
  assert(state.feed[0] === "form-b" && state.feed[1] === "form-a", "feed ordered by publish HLC, not id");
}

// ── 7. mergeEvents: union + MIN-HLC conflict rule ─────────────────────────────
console.log("\n── mergeEvents ──");
{
  const a1 = { id: "e1", hlc: hlc(1000, 0, "a"), type: "t", payload: {} };
  const a2 = { id: "e2", hlc: hlc(2000, 0, "a"), type: "t", payload: {} };
  const b1 = { id: "e1", hlc: hlc(900, 0, "b"), type: "t", payload: {} };  // same id, EARLIER hlc
  const b2 = { id: "e3", hlc: hlc(3000, 0, "b"), type: "t", payload: {} };

  const merged = mergeEvents([[a1, a2], [b1, b2]]);
  assert(merged.length === 3, "union by id (3 unique)");
  const e1 = merged.find((e) => e.id === "e1");
  assert(e1.hlc.wall === 900, "MIN-HLC wins on conflict (900 < 1000)");
  assert(merged[0].id === "e1" && merged[1].id === "e2" && merged[2].id === "e3", "merged sorted by HLC");
}

// ── 8. compareHlc / totalOrder ────────────────────────────────────────────────
console.log("\n── compareHlc / totalOrder ──");
{
  assert(compareHlc(hlc(1000), hlc(2000)) < 0, "wall: earlier < later");
  assert(compareHlc(hlc(1000, 1), hlc(1000, 2)) < 0, "ctr: lower < higher (same wall)");
  assert(compareHlc(hlc(1000, 0, "a"), hlc(1000, 0, "b")) < 0, "dev: tiebreak by device id");
  assert(compareHlc(hlc(1000), hlc(1000)) === 0, "equal hlc → 0");

  const x = { id: "e2", hlc: hlc(1000), type: "t", payload: {} };
  const y = { id: "e1", hlc: hlc(1000), type: "t", payload: {} };
  assert(totalOrder(x, y) > 0, "same hlc → tiebreak by id (e2 > e1)");
}

// ── 9. HlcClock monotonicity ──────────────────────────────────────────────────
console.log("\n── HlcClock ──");
{
  const clock = new HlcClock("dev1");
  const t1 = clock.now();
  const t2 = clock.now();
  // two now() in the same ms must still be strictly ordered (ctr increments)
  assert(compareHlc(t1, t2) < 0, "now() is strictly monotonic within same ms");

  // receive a FUTURE remote hlc → next now() must be at/after it.
  // Capture the future wall ONCE and compare against that constant — comparing
  // against a fresh Date.now() is flaky (the clock advances between the two reads).
  const futureWall = Date.now() + 5000;
  clock.receive(hlc(futureWall, 0, "remote"));
  const t3 = clock.now();
  assert(t3.wall >= futureWall, "receive(future) advances the clock");
  assert(t3.dev === "dev1", "local device id preserved after receive");
}

// ── 10. computeCreatorView: decrypt + assign + one-per-respondent ─────────────
console.log("\n── computeCreatorView ──");
{
  const alice = deriveIdentity();   // creator
  const bob = deriveIdentity();     // respondent
  const carol = deriveIdentity();   // foreign (can't decrypt)

  const form = makeForm("form-1", alice.address, alice.pubHex, "S", [{ id: "q1", type: "text", text: "A", required: true }]);

  // bob seals a response to alice's public key
  const bobPayload = JSON.stringify({ formId: "form-1", respondent: bob.address, answers: [{ question: "A", answer: "sushi" }] });
  const bobSealed = bytesToBase64(seal(new TextEncoder().encode(bobPayload), pubKeyFromHex(alice.pubHex)));

  // bob submits TWICE (earlier + later) → only earliest should count
  const respEarly = { id: "resp-bob-1", sealed: bobSealed, from: bob.address };
  const respLate = { id: "resp-bob-2", sealed: bobSealed, from: bob.address };

  // carol's response is sealed to a DIFFERENT key → alice can't open it
  const carolPayload = JSON.stringify({ formId: "form-1", respondent: carol.address, answers: [{ question: "A", answer: "x" }] });
  const carolSealed = bytesToBase64(seal(new TextEncoder().encode(carolPayload), pubKeyFromHex(carol.pubHex)));
  const respCarol = { id: "resp-carol-1", sealed: carolSealed, from: carol.address };

  const state = computeState([
    ev("e1", "form.publish", form, 1000),
    ev("e2", "response.submit", respEarly, 2000),
    ev("e3", "response.submit", respLate, 3000),
    ev("e4", "response.submit", respCarol, 4000),
  ], alice.address);

  const openFn = (sealedBytes) => {
    try { return open(sealedBytes, alice.privKey); } catch { return null; }
  };
  const view = computeCreatorView(state, alice.address, openFn);

  assert(view.forms.length === 1 && view.forms[0] === "form-1", "creator sees their own form");
  assert(view.responses["form-1"].length === 1, "one response per respondent (bob's dup collapsed)");
  assert(view.responses["form-1"][0].answers[0].answer === "sushi", "response decrypted correctly");
  assert(view.undecrypted >= 1, "carol's foreign-key response counted as undecrypted");
}

// ── 11. computeCreatorView: non-creator sees nothing ──────────────────────────
console.log("\n── computeCreatorView (non-creator) ──");
{
  const alice = deriveIdentity();
  const mallory = deriveIdentity();
  const form = makeForm("form-1", alice.address, alice.pubHex, "S", []);
  const state = computeState([ev("e1", "form.publish", form, 1000)], alice.address);
  const view = computeCreatorView(state, mallory.address, () => null);
  assert(view.forms.length === 0, "non-creator has no forms in their view");
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}\n`);

if (failed > 0) process.exit(1);
