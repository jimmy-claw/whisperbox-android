// whisperbox-android — transport adapter over loam-transport.
// Supplies: topic, envelope dispatch (EVENT / SYNC_REQ), seal/open.
// The transport moves opaque bytes; we handle the wire envelope format.
//
// Wire model (same as whisperbox_core):
//   Messages are PLAIN JSON envelopes over the delivery channel.
//   NO transport-level AEAD. Privacy = ECIES on response payloads.
//   Envelopes:
//     {v:1, type:"EVENT", event:{...}}
//     {v:1, type:"SYNC_REQ", from:<deviceId>}
//   Channel payload = base64 TEXT of the envelope (delivery base64-encodes once more).

import * as transport from "loam-transport";
import { TOPIC, WbEvent } from "./engine";
import { Identity } from "./crypto";

type OnEvent = (event: WbEvent) => void;
type OnSyncReq = (from: string) => void;
type OnStatus = (s: string) => void;

let identity: Identity | null = null;
let deviceId = "";

// ── Envelope encode/decode ────────────────────────────────────────────────────

function envEvent(event: WbEvent): string {
  return JSON.stringify({ v: 1, type: "EVENT", event });
}

function envSyncReq(from: string): string {
  return JSON.stringify({ v: 1, type: "SYNC_REQ", from });
}

function parseEnvelope(text: string): { type: string; event?: WbEvent; from?: string } | null {
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

// Peel base64 layers (delivery may encode 1 or 2 times)
function peelBase64(raw: string): string {
  let s = raw.trim();
  for (let i = 0; i < 2; i++) {
    if (s.startsWith("{") || s.startsWith("[")) break;
    try {
      s = Buffer.from(s, "base64").toString("utf8");
    } catch {
      break;
    }
  }
  return s;
}

// ── onReceive: try to parse envelope, dispatch ────────────────────────────────

function onReceive(_topic: string, candidates: Uint8Array[]): boolean {
  for (const cand of candidates) {
    try {
      const text = peelBase64(new TextDecoder().decode(cand));
      const env = parseEnvelope(text);
      if (!env) continue;

      if (env.type === "EVENT" && env.event) {
        // Dispatch to app
        eventHandlers.forEach((fn) => fn(env.event!));
        return true;
      }
      if (env.type === "SYNC_REQ" && env.from) {
        syncReqHandlers.forEach((fn) => fn(env.from!));
        return true;
      }
    } catch { /* try next candidate */ }
  }
  return false;
}

// ── Handler registration ──────────────────────────────────────────────────────

const eventHandlers: OnEvent[] = [];
const syncReqHandlers: OnSyncReq[] = [];
const statusHandlers: OnStatus[] = [];

export function onEvent(fn: OnEvent): void {
  eventHandlers.push(fn);
}

export function onSyncReq(fn: OnSyncReq): void {
  syncReqHandlers.push(fn);
}

export function onStatus(fn: OnStatus): void {
  statusHandlers.push(fn);
}

// ── Node lifecycle ────────────────────────────────────────────────────────────

export async function startNode(id: Identity, devId: string): Promise<void> {
  identity = id;
  deviceId = devId;

  await transport.start({
    deviceId: devId,
    topics: [TOPIC],
    onStatus: (s: string) => statusHandlers.forEach((fn) => fn(s)),
    onReceive,
  });
}

export async function stopNode(): Promise<void> {
  await transport.stop();
}

// ── Publish ───────────────────────────────────────────────────────────────────

export async function publishEvent(event: WbEvent): Promise<void> {
  const text = envEvent(event);
  const bytes = new TextEncoder().encode(text);
  await transport.publishSealed(TOPIC, bytes);
}

export async function sendSyncReq(): Promise<void> {
  const text = envSyncReq(deviceId);
  const bytes = new TextEncoder().encode(text);
  await transport.publishSealed(TOPIC, bytes);
}

// ── Store sync (cold-start history pull) ──────────────────────────────────────

export async function storeSync(): Promise<number> {
  const res = await transport.storeSync((_topic, candidates) => {
    for (const cand of candidates) {
      try {
        const text = peelBase64(new TextDecoder().decode(cand));
        const env = parseEnvelope(text);
        if (env && env.type === "EVENT" && env.event) {
          eventHandlers.forEach((fn) => fn(env.event!));
          return true;
        }
        break;
      } catch { /* try next */ }
    }
    return false;
  });
  return res.events;
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

export function getPeerCount(): number {
  return transport.counters?.peers ?? -1;
}

export function getShard(): number {
  return transport.shardFor ? transport.shardFor(TOPIC) : -1;
}
