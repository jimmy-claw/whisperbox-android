// whisperbox-android — wire envelope encode/decode.
//
// PURE module: no react-native, no loam-transport, no native deps. This is the
// exact code path that decides whether the app can DECODE a mesh message, so it
// lives here (not buried in app-state.ts) and is covered by test/envelope-test.mjs.
//
// Wire model (same as whisperbox_core / qaku):
//   Messages are PLAIN JSON envelopes over the delivery channel.
//   NO transport-level AEAD. Privacy = ECIES on response payloads.
//   Envelopes:
//     {v:1, type:"EVENT", event:{...}}
//     {v:1, type:"SYNC_REQ", from:<deviceId>}
//
// The delivery layer base64-encodes the payload one or two times (see
// loam-transport RealNode.send: double-base64 over the SDS channel). On receive,
// loam-transport hands us a set of "candidates" (partially peeled byte arrays).
// peelBase64() is defensive: it peels up to TWO more layers, stopping as soon as
// the text looks like JSON — so it recovers the envelope regardless of how many
// layers the transport already peeled. That robustness is the whole point and is
// what the test locks in.

import { toByteArray } from "base64-js";
import { WbEvent } from "./engine";

export interface ParsedEnvelope {
  type: string;
  event?: WbEvent;
  from?: string;
}

// ── Encode ────────────────────────────────────────────────────────────────────

export function envEvent(event: WbEvent): string {
  return JSON.stringify({ v: 1, type: "EVENT", event });
}

export function envSyncReq(from: string): string {
  return JSON.stringify({ v: 1, type: "SYNC_REQ", from });
}

// ── Decode ────────────────────────────────────────────────────────────────────

export function parseEnvelope(text: string): ParsedEnvelope | null {
  try {
    const o = JSON.parse(text);
    if (!o || typeof o.type !== "string") return null;
    if (o.type === "EVENT" && o.event && typeof o.event === "object") {
      return { type: "EVENT", event: o.event };
    }
    if (o.type === "SYNC_REQ") {
      return { type: "SYNC_REQ", from: typeof o.from === "string" ? o.from : "" };
    }
    return null;
  } catch {
    return null;
  }
}

// Peel up to two base64 layers, stopping as soon as the result looks like JSON
// (starts with "{" or "["). Defensive against the transport having already peeled
// some layers — see module header.
export function peelBase64(raw: string): string {
  let s = raw.trim();
  for (let i = 0; i < 2; i++) {
    if (s.startsWith("{") || s.startsWith("[")) break;
    try {
      s = new TextDecoder().decode(toByteArray(s));
    } catch {
      break;
    }
  }
  return s;
}

// The full receive path for ONE candidate byte array: decode as UTF-8, peel
// base64, parse the envelope. Returns null if this candidate isn't a valid
// envelope (the caller tries the next candidate). This is the single function
// app-state.ts's onReceive/storeSync callbacks reduce to.
export function openCandidate(cand: Uint8Array): ParsedEnvelope | null {
  try {
    const text = peelBase64(new TextDecoder().decode(cand));
    return parseEnvelope(text);
  } catch {
    return null;
  }
}
