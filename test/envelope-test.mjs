// envelope-test.mjs — wire envelope encode/decode + base64-peel robustness.
// Run: npx tsx test/envelope-test.mjs
//
// This is the code path that decides whether the app can DECODE a mesh message.
// The delivery layer base64-encodes the payload one or two times (loam-transport
// RealNode.send does double-base64 over the SDS channel), and on receive hands us
// "candidates" at an unknown peeling depth. openCandidate() must recover the
// envelope regardless of how many layers remain. That robustness is the property
// under test — a regression here = "app connects but never decodes anything".

import { fromByteArray, toByteArray } from "base64-js";
import {
  envEvent, envSyncReq, parseEnvelope, peelBase64, openCandidate,
} from "../src/envelope.ts";

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const utf8 = (s) => new TextEncoder().encode(s);
const fromUtf8 = (b) => new TextDecoder().decode(b);

// A realistic form.publish event
const sampleEvent = {
  id: "publish-form-abc123",
  hlc: { wall: 1700000000000, ctr: 0, dev: "dev1" },
  type: "form.publish",
  payload: {
    id: "form-abc123",
    title: "Lunch poll",
    creator: "0xabc",
    publicKey: "0xdef",
    questions: [{ id: "q1", type: "text", text: "Sushi or tacos?", required: true }],
  },
};

// ── 1. envEvent → parseEnvelope round-trip ───────────────────────────────────
console.log("\n── envEvent round-trip ──");
{
  const wire = envEvent(sampleEvent);
  const parsed = parseEnvelope(wire);
  assert(parsed !== null, "envEvent produces a parseable envelope");
  assert(parsed.type === "EVENT", "type is EVENT");
  assert(parsed.event.id === sampleEvent.id, "event id preserved");
  assert(parsed.event.type === "form.publish", "event type preserved");
  assert(parsed.event.payload.title === "Lunch poll", "payload preserved");
}

// ── 2. envSyncReq → parseEnvelope round-trip ─────────────────────────────────
console.log("\n── envSyncReq round-trip ──");
{
  const wire = envSyncReq("dev1");
  const parsed = parseEnvelope(wire);
  assert(parsed !== null && parsed.type === "SYNC_REQ", "SYNC_REQ parsed");
  assert(parsed.from === "dev1", "from preserved");
}

// ── 3. parseEnvelope rejects garbage / wrong shape ───────────────────────────
console.log("\n── parseEnvelope rejection ──");
{
  assert(parseEnvelope("not json at all") === null, "rejects non-JSON");
  assert(parseEnvelope(JSON.stringify({ foo: "bar" })) === null, "rejects missing type");
  assert(parseEnvelope(JSON.stringify({ type: "EVENT" })) === null, "rejects EVENT with no event");
  assert(parseEnvelope(JSON.stringify({ type: "BOGUS" })) === null, "rejects unknown type");
  assert(parseEnvelope("") === null, "rejects empty string");
}

// ── 4. peelBase64: 0 / 1 / 2 layers ──────────────────────────────────────────
console.log("\n── peelBase64 layer counts ──");
{
  const json = envEvent(sampleEvent);

  // 0 layers: already JSON → returned as-is
  assert(peelBase64(json) === json, "0 layers: raw JSON returned unchanged");

  // 1 layer: base64(JSON)
  const b1 = fromByteArray(utf8(json));
  assert(peelBase64(b1) === json, "1 layer: base64(JSON) → JSON");

  // 2 layers: base64(base64(JSON))
  const b2 = fromByteArray(utf8(b1));
  assert(peelBase64(b2) === json, "2 layers: base64(base64(JSON)) → JSON");

  // whitespace-tolerant
  assert(peelBase64("  " + b1 + "\n") === json, "trims surrounding whitespace");
}

// ── 5. openCandidate: envelope at 0 / 1 / 2 base64 layers (as bytes) ─────────
// A candidate is a Uint8Array. The realistic candidates are the UTF-8 bytes of
// the envelope string at each base64-wrapping level (this is exactly what
// loam-transport's payloadCandidates emits — see test #7).
console.log("\n── openCandidate at each peeling depth ──");
{
  const J = envEvent(sampleEvent);
  const b1 = fromByteArray(utf8(J));   // base64(JSON)
  const b2 = fromByteArray(utf8(b1));  // base64(base64(JSON))
  const at0 = utf8(J);   // 0 layers: bytes of the JSON string
  const at1 = utf8(b1);  // 1 layer:  bytes of base64(JSON)
  const at2 = utf8(b2);  // 2 layers: bytes of base64(base64(JSON))

  const cases = [["0 layers", at0], ["1 layer", at1], ["2 layers", at2]];
  for (const [label, cand] of cases) {
    const env = openCandidate(cand);
    assert(env !== null && env.type === "EVENT", `${label}: candidate opens to EVENT`);
    assert(env && env.event.id === sampleEvent.id, `${label}: event id recovered`);
  }
}

// ── 6. openCandidate: garbage → null (never throws) ──────────────────────────
console.log("\n── openCandidate garbage handling ──");
{
  assert(openCandidate(utf8("this is not an envelope")) === null, "plain text → null");
  assert(openCandidate(new Uint8Array([0, 1, 2, 3, 255, 254])) === null, "binary garbage → null");
  assert(openCandidate(new Uint8Array([])) === null, "empty → null");
  // base64 of garbage (peels to non-JSON) → null
  assert(openCandidate(toByteArray(fromByteArray(utf8("garbage")))) === null, "base64(garbage) → null");
}

// ── 7. Realistic loam-transport double-base64 wire path ──────────────────────
// Replicates RealNode.send (double-base64) + the FFI's one base64-decode +
// payloadCandidates, then verifies at least one candidate opens to our event.
// This is the end-to-end shape the app actually sees on the wire.
console.log("\n── realistic double-base64 wire path ──");
{
  // RealNode.send: sealed → base64 → base64 (double)
  const sealed = utf8(envEvent(sampleEvent));
  const sealedB64 = fromByteArray(sealed);
  const doubled = fromByteArray(utf8(sealedB64));   // wire payload

  // payloadCandidates (copied from loam-transport logos-transport.ts)
  function payloadCandidates(payload) {
    const out = [];
    if (Array.isArray(payload)) {
      let s = "";
      for (let i = 0; i < payload.length; i++) s += String.fromCharCode(payload[i] & 0xff);
      let once = null;
      try { once = toByteArray(s); out.push(once); } catch { /* */ }
      if (once) { try { out.push(toByteArray(fromUtf8(once))); } catch { /* */ } }
      out.push(Uint8Array.from(payload.map((b) => b & 0xff)));
    } else if (typeof payload === "string") {
      try {
        const once = toByteArray(payload);
        out.push(once);
        try { out.push(toByteArray(fromUtf8(once))); } catch { /* */ }
      } catch { /* */ }
    }
    return out;
  }

  // The FFI hands the wire payload to JS as either the raw base64 string OR a
  // JSON array of bytes (after its one base64-decode). NOTE: never a raw
  // Uint8Array — payloadCandidates only handles Array + string, and JSON can't
  // carry a Uint8Array. Test both realistic shapes.
  const asString = payloadCandidates(doubled);                              // wire as base64 string
  const asDecodedArray = payloadCandidates(Array.from(toByteArray(doubled))); // FFI decoded once → byte array

  const opens = (cands) =>
    cands.some((c) => { const e = openCandidate(c); return e && e.type === "EVENT" && e.event.id === sampleEvent.id; });

  assert(opens(asString), "wire-as-string: some candidate opens to our event");
  assert(opens(asDecodedArray), "wire-as-byte-array: some candidate opens to our event");
  // Sanity: a raw Uint8Array is NOT a realistic FFI shape (payloadCandidates
  // returns [] for it) — document that so nobody "fixes" it into a false positive.
  assert(payloadCandidates(toByteArray(doubled)).length === 0, "raw Uint8Array → no candidates (not a real FFI shape)");
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}\n`);

if (failed > 0) process.exit(1);
