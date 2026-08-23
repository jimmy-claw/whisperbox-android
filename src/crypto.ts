// whisperbox-android — ECIES response sealing (TypeScript).
// BYTE-PARITY with whisperbox-logos/whisperbox_core/src/whisperbox_crypto.hpp
// and packages/contract/src/crypto.mjs.
//
// ── Identity (qaku convention; sha256-based address, NOT keccak/EVM) ──────────────
//   priv      = 32B scalar (1..n-1 of secp256k1)
//   pub       = 33B compressed point (0x02|0x03 || X)
//   address   = "0x" + hex(sha256(pub_compressed))[48..64]      // last 20 bytes
//
// ── Response sealing (ECIES to the creator; ONLY the creator can open) ────────────
//   ephPriv = 32B CSPRNG            (or explicit for deterministic tests)
//   ephPub  = secp256k1(ephPriv), compressed 33B
//   Sx      = X-coordinate (32B) of the ECDH shared point
//             sender:  ECDH(ephPriv, creatorPub);  creator: ECDH(creatorPriv, ephPub)
//   K       = HKDF-SHA256(ikm=Sx, salt="whisperbox-ecies-v1", info="", L=32)
//   nonce   = 12B CSPRNG            (or sha256("whisperbox-nonce-v1|"||ephPriv||creatorPub)[0..12]
//                                    when deterministic — golden vectors)
//   aad     = creatorPub(33) || ephPub(33)
//   sealed  = 0x01 || ephPub(33) || nonce(12) || ChaCha20-Poly1305(K, nonce, pt, aad) || tag(16)

import { secp256k1 } from "@noble/curves/secp256k1";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { sha256 } from "@noble/hashes/sha256";
import { hkdf } from "@noble/hashes/hkdf";
import { randomBytes } from "@noble/hashes/utils";

const SALT = new TextEncoder().encode("whisperbox-ecies-v1");
const NONCE_PREFIX = new TextEncoder().encode("whisperbox-nonce-v1|");
const VERSION = 0x01;

export interface Identity {
  privKey: Uint8Array;  // 32B
  pubKey: Uint8Array;   // 33B compressed
  pubHex: string;       // 66 hex chars
  address: string;      // 0x + 40 hex chars (last 20 bytes of sha256(pub))
}

export function toHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function fromHex(s: string): Uint8Array {
  if (s.length % 2 !== 0) throw new Error("bad hex length");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function deriveIdentity(privKey?: Uint8Array): Identity {
  const priv = privKey ?? randomBytes(32);
  const pub = secp256k1.getPublicKey(priv, true); // compressed 33B
  const pubHash = sha256(pub);
  // address = "0x" + last 20 bytes of sha256(pub)
  const address = "0x" + toHex(pubHash.slice(12)); // bytes 12..32 = last 20
  return {
    privKey: priv,
    pubKey: pub,
    pubHex: toHex(pub),
    address,
  };
}

export function pubKeyFromAddress(address: string): Uint8Array {
  // This is a convenience for when you have the pubHex stored in the form def.
  // The address itself is NOT the pubkey — it's sha256(pub).slice(12).
  // For ECIES you need the actual 33B pubkey, which is stored in form.publicKey.
  throw new Error("Use form.publicKey (pubHex), not address, for ECIES");
}

export function pubKeyFromHex(pubHex: string): Uint8Array {
  return fromHex(pubHex);
}

/**
 * Seal plaintext to a recipient's public key.
 * Returns: 0x01 || ephPub(33) || nonce(12) || ciphertext || tag(16)
 */
export function seal(
  plaintext: Uint8Array,
  recipientPub: Uint8Array,
  opts?: { ephPriv?: Uint8Array; deterministic?: boolean }
): Uint8Array {
  const ephPriv = opts?.ephPriv ?? randomBytes(32);
  const ephPub = secp256k1.getPublicKey(ephPriv, true); // 33B

  // ECDH: shared point = ephPriv * recipientPub
  const ephPrivBig = bytesToBig(ephPriv);
  const sharedPoint = secp256k1.ProjectivePoint.fromHex(recipientPub).multiply(ephPrivBig);
  const sx = to32Bytes(sharedPoint.x as bigint);

  // K = HKDF-SHA256(ikm=Sx, salt="whisperbox-ecies-v1", info="", L=32)
  const key = hkdf(sha256, sx, SALT, new Uint8Array(0), 32);

  // nonce: deterministic or random
  let nonce: Uint8Array;
  if (opts?.deterministic) {
    // sha256("whisperbox-nonce-v1|" || ephPriv || creatorPub)[0..12]
    const concat = new Uint8Array(NONCE_PREFIX.length + ephPriv.length + recipientPub.length);
    concat.set(NONCE_PREFIX, 0);
    concat.set(ephPriv, NONCE_PREFIX.length);
    concat.set(recipientPub, NONCE_PREFIX.length + ephPriv.length);
    nonce = sha256(concat).slice(0, 12);
  } else {
    nonce = randomBytes(12);
  }

  // aad = creatorPub(33) || ephPub(33)
  const aad = new Uint8Array(66);
  aad.set(recipientPub, 0);
  aad.set(ephPub, 33);

  // ChaCha20-Poly1305 encrypt (output includes 16B tag)
  const cipher = chacha20poly1305(key, nonce, aad);
  const ct = cipher.encrypt(plaintext);

  // Assemble: 0x01 || ephPub(33) || nonce(12) || ct+tag
  const out = new Uint8Array(1 + 33 + 12 + ct.length);
  out[0] = VERSION;
  out.set(ephPub, 1);
  out.set(nonce, 34);
  out.set(ct, 46);
  return out;
}

/**
 * Open (decrypt) a sealed blob with the recipient's private key.
 * Returns plaintext, or throws if authentication fails.
 */
export function open(sealed: Uint8Array, privKey: Uint8Array): Uint8Array {
  if (sealed.length < 47) throw new Error("sealed too short");
  if (sealed[0] !== VERSION) throw new Error("bad version");

  const ephPub = sealed.slice(1, 34);
  const nonce = sealed.slice(34, 46);
  const ct = sealed.slice(46); // ciphertext + 16B tag

  // ECDH: shared point = privKey * ephPub
  const privBig = bytesToBig(privKey);
  const ephPoint = secp256k1.ProjectivePoint.fromHex(ephPub);
  const sharedPoint = ephPoint.multiply(privBig);
  const sx = to32Bytes(sharedPoint.x as bigint);

  // K = HKDF-SHA256(ikm=Sx, salt="whisperbox-ecies-v1", info="", L=32)
  const key = hkdf(sha256, sx, SALT, new Uint8Array(0), 32);

  // aad = recipientPub(33) || ephPub(33)
  const recipientPub = secp256k1.getPublicKey(privKey, true);
  const aad = new Uint8Array(66);
  aad.set(recipientPub, 0);
  aad.set(ephPub, 33);

  // ChaCha20-Poly1305 decrypt (throws on auth failure)
  const cipher = chacha20poly1305(key, nonce, aad);
  return cipher.decrypt(ct);
}

function to32Bytes(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function bytesToBig(b: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < b.length; i++) {
    result = (result << 8n) | BigInt(b[i]);
  }
  return result;
}
