// parity-test.mjs — ECIES byte-parity test against whisperbox-logos golden vectors.
// Run: npx tsx test/parity-test.mjs
//
// Verifies:
//   1. Identity derivation (address = 0x + last 20 bytes of sha256(pub))
//   2. Deterministic seal (byte-identical to C++ output)
//   3. Open (decrypt what C++ sealed)
//   4. Round-trip (seal → open → same plaintext)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveIdentity, seal, open, toHex, fromHex } from "../src/crypto.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../whisperbox-logos/packages/contract/test/fixtures");

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

// ── 1. Identity derivation ─────────────────────────────────────────────────────
console.log("\n── Identity derivation ──");

const identities = JSON.parse(readFileSync(join(fixturesDir, "crypto-identities.json"), "utf8"));

for (const id of identities.identities) {
  const derived = deriveIdentity(fromHex(id.privHex));
  assert(derived.pubHex === id.pubHex, `${id.name}: pubHex matches`);
  assert(derived.address === id.address, `${id.name}: address matches (${derived.address} vs ${id.address})`);
}

// ── 2. Deterministic seal (byte-parity with C++) ───────────────────────────────
console.log("\n── Deterministic seal (byte-parity) ──");

const seals = JSON.parse(readFileSync(join(fixturesDir, "crypto-sealed.json"), "utf8"));
const idMap = Object.fromEntries(identities.identities.map((i) => [i.name, i]));

for (const s of seals.seals) {
  const creator = idMap[s.creatorName];
  const respondent = idMap[s.respondentName];
  const ephPriv = fromHex(s.ephPrivHex);
  const plaintext = new TextEncoder().encode(s.plaintext);
  const recipientPub = fromHex(creator.pubHex);

  const sealed = seal(plaintext, recipientPub, { ephPriv, deterministic: true });
  const sealedHex = toHex(sealed);

  assert(
    sealedHex === s.sealedHex,
    `${s.id}: seal byte-identical (${sealedHex.slice(0, 32)}… vs ${s.sealedHex.slice(0, 32)}…)`
  );
}

// ── 3. Open (decrypt what C++ sealed) ─────────────────────────────────────────
console.log("\n── Open (decrypt C++ seals) ──");

for (const s of seals.seals) {
  const creator = idMap[s.creatorName];
  const sealedBytes = fromHex(s.sealedHex);
  const creatorPriv = fromHex(creator.privHex);

  try {
    const decrypted = open(sealedBytes, creatorPriv);
    const text = new TextDecoder().decode(decrypted);
    assert(text === s.plaintext, `${s.id}: open → "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"`);
  } catch (e) {
    assert(false, `${s.id}: open FAILED — ${e.message}`);
  }
}

// ── 4. Round-trip (seal → open) ───────────────────────────────────────────────
console.log("\n── Round-trip ──");

const alice = idMap["alice"];
const bob = idMap["bob"];
const testMsg = "round-trip test: čůtek 🤖";
const msgBytes = new TextEncoder().encode(testMsg);
const bobPub = fromHex(bob.pubHex);
const bobPriv = fromHex(bob.privHex);

const rtSealed = seal(msgBytes, bobPub);
try {
  const rtDecrypted = open(rtSealed, bobPriv);
  const rtText = new TextDecoder().decode(rtDecrypted);
  assert(rtText === testMsg, `round-trip: "${rtText}"`);
} catch (e) {
  assert(false, `round-trip FAILED — ${e.message}`);
}

// Wrong key should fail
const alicePriv = fromHex(alice.privHex);
try {
  open(rtSealed, alicePriv);
  assert(false, "wrong key should have thrown");
} catch {
  assert(true, "wrong key correctly rejected");
}

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}\n`);

if (failed > 0) process.exit(1);
