// whisperbox-android — base64 + hex helpers (React Native compatible, no Buffer).

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += B64_CHARS[b1 >> 2];
    result += B64_CHARS[((b1 & 3) << 4) | (b2 >> 4)];
    result += i + 1 < bytes.length ? B64_CHARS[((b2 & 15) << 2) | (b3 >> 6)] : "=";
    result += i + 2 < bytes.length ? B64_CHARS[b3 & 63] : "=";
  }
  return result;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=/g, "");
  const lookup = new Uint8Array(256);
  for (let i = 0; i < B64_CHARS.length; i++) lookup[B64_CHARS.charCodeAt(i)] = i;
  const out = new Uint8Array(Math.floor(clean.length * 6 / 8));
  let oi = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c1 = lookup[clean.charCodeAt(i)] || 0;
    const c2 = i + 1 < clean.length ? (lookup[clean.charCodeAt(i + 1)] || 0) : 0;
    const c3 = i + 2 < clean.length ? (lookup[clean.charCodeAt(i + 2)] || 0) : 0;
    const c4 = i + 3 < clean.length ? (lookup[clean.charCodeAt(i + 3)] || 0) : 0;
    if (oi < out.length) out[oi++] = (c1 << 2) | (c2 >> 4);
    if (oi < out.length) out[oi++] = ((c2 & 15) << 4) | (c3 >> 2);
    if (oi < out.length) out[oi++] = ((c3 & 3) << 6) | c4;
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
