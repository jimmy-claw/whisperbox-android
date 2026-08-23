// whisperbox-android — device identity.
// Persists a secp256k1 keypair in expo-secure-store.
// The address (0x + hex(pubKey)) is the on-wire identity.

import * as SecureStore from "expo-secure-store";
import { deriveIdentity, Identity } from "./crypto";

const KEY_NAME = "whisperbox-identity";

let cached: Identity | null = null;

export async function getIdentity(): Promise<Identity> {
  if (cached) return cached;
  try {
    const stored = await SecureStore.getItemAsync(KEY_NAME);
    if (stored) {
      const hex = stored;
      const privKey = new Uint8Array(Buffer.from(hex, "hex"));
      cached = deriveIdentity(privKey);
      return cached;
    }
  } catch { /* first run */ }

  // Generate new identity
  const id = deriveIdentity();
  const hex = Buffer.from(id.privKey).toString("hex");
  await SecureStore.setItemAsync(KEY_NAME, hex);
  cached = id;
  return id;
}

export function resetIdentity(): void {
  cached = null;
}
