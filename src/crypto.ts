// whisperbox-android — ECIES response sealing (TypeScript).
// BYTE-PARITY with whisperbox-logos/whisperbox_core/src/whisperbox_crypto.hpp:
//   ephPriv = 32B (CSPRNG)
//   ephPub  = secp256k1(ephPriv), compressed 33B
//   Sx      = X-coordinate (32B) of the ECDH shared point
//   K       = HKDF-SHA256(ikm=Sx, salt="whisperbox-ecies-v1", info="", L=32)
//   nonce   = 12B CSPRNG
//   aad     = creatorPub(33) || ephPub(33)
//   sealed  = 0x01 || ephPub(33) || nonce(12) || ChaCha20-Poly1305(K, nonce, pt, aad) || tag(16)
//
// Uses @noble/curves (secp256k1) + @noble/ciphers (ChaCha20-Poly1305) + @noble/hashes (sha256, hkdf).
// No native deps — pure JS, runs on Hermes.

import { secp256k1 } from "@noble/curves/secp256k1";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { sha256 } from "@noble/hashes/sha256";
import { hkdf } from "@noble/hashes/hkdf";
import { randomBytes } from "@noble/hashes/utils";

const SALT = new TextEncoder().encode("whisperbox-ecies-v1");
const VERSION = 0x01;

export interface Identity {
  privKey: Uint8Array;  // 32B
  pubKey: Uint8Array;   // 33B compressed
  address: string;      // 0x + hex(pubKey)
}

export function deriveIdentity(privKey?: Uint8Array): Identity {
  const priv = privKey ?? randomBytes(32);
  const pub = secp256k1.getPublicKey(priv, true); // compressed 33B
  const address = "0x" + Buffer.from(pub).toString("hex");
  return { privKey: priv, pubKey: pub, address };
}

export function pubKeyFromAddress(address: string): Uint8Array {
  const hex = address.startsWith("0x") ? address.slice(2) : address;
  return new Uint8Array(Buffer.from(hex, "hex"));
}

/**
 * Seal plaintext to a recipient's public key.
 * Returns: 0x01 || ephPub(33) || nonce(12) || ciphertext || tag(16)
 */
export function seal(plaintext: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  const ephPriv = randomBytes(32);
  const ephPub = secp256k1.getPublicKey(ephPriv, true); // 33B

  // ECDH: shared point = ephPriv * recipientPub
  const sharedPoint = secp256k1.ProjectivePoint.fromHex(recipientPub).multiply(ephPriv);
  const sx = sharedPoint.x as bigint; // X coordinate
  const sxBytes = to32Bytes(sx);

  // K = HKDF-SHA256(ikm=Sx, salt="whisperbox-ecies-v1", info="", L=32)
  const key = hkdf(sha256, sxBytes, SALT, new Uint8Array(0), 32);

  // nonce = 12B CSPRNG
  const nonce = randomBytes(12);

  // aad = creatorPub(33) || ephPub(33)
  const aad = new Uint8Array(66);
  aad.set(recipientPub, 0);
  aad.set(ephPub, 33);

  // ChaCha20-Poly1305 encrypt
  const cipher = chacha20poly1305(key);
  const ct = cipher.encrypt(nonce, plaintext, aad); // includes 16B tag

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
  const ephPoint = secp256k1.ProjectivePoint.fromHex(ephPub);
  const sharedPoint = ephPoint.multiply(privKey);
  const sx = sharedPoint.x as bigint;
  const sxBytes = to32Bytes(sx);

  // K = HKDF-SHA256(ikm=Sx, salt="whisperbox-ecies-v1", info="", L=32)
  const key = hkdf(sha256, sxBytes, SALT, new Uint8Array(0), 32);

  // aad = recipientPub(33) || ephPub(33)
  const recipientPub = secp256k1.getPublicKey(privKey, true);
  const aad = new Uint8Array(66);
  aad.set(recipientPub, 0);
  aad.set(ephPub, 33);

  // ChaCha20-Poly1305 decrypt
  const cipher = chacha20poly1305(key);
  return cipher.decrypt(nonce, ct, aad); // throws on auth failure
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
