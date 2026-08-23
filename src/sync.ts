// whisperbox-android — sync adapter over loam-sync.
// Handles: reconcile (RBSR), catchup (backfill protocol).
// The transport moves bytes; loam-sync decides WHICH bytes to send.
//
// Protocol:
//   - On join: send SYNC_REQ (RBSR initial: have=[])
//   - On receiving SYNC_REQ: respond with RBSR delta
//   - Periodic: reconcile to detect gaps

import { WbEvent, mergeEvents, totalOrder } from "./engine";
import { publishEvent, sendSyncReq, onSyncReq } from "./mock-transport";

// ── Event store (in-memory + AsyncStorage persistence) ────────────────────────

let log: WbEvent[] = [];
let logDirty = false;

export function getLog(): WbEvent[] {
  return log;
}

export function setLog(events: WbEvent[]): void {
  log = events;
  logDirty = true;
}

export function appendEvent(e: WbEvent): void {
  // Dedup by id
  const idx = log.findIndex((x) => x.id === e.id);
  if (idx >= 0) {
    // MIN-HLC conflict rule
    if (compareHlcLocal(e.hlc, log[idx].hlc) < 0) {
      log[idx] = e;
    }
    return;
  }
  log.push(e);
  log.sort(totalOrder);
  logDirty = true;
}

function compareHlcLocal(a: any, b: any): number {
  if (a.wall !== b.wall) return a.wall < b.wall ? -1 : 1;
  if (a.ctr !== b.ctr) return a.ctr < b.ctr ? -1 : 1;
  if (a.dev !== b.dev) return a.dev < b.dev ? -1 : 1;
  return 0;
}

// ── RBSR fingerprint (simplified: sorted id list) ─────────────────────────────
// Full RBSR uses a fingerprint (e.g., XOR of hashes) + id list for the delta.
// For v1, we use the simple approach: send all ids, peer responds with what it's missing.

export function getEventIds(): string[] {
  return log.map((e) => e.id);
}

export function getEventsByIds(ids: string[]): WbEvent[] {
  const idSet = new Set(ids);
  return log.filter((e) => idSet.has(e.id));
}

// ── Catchup protocol ──────────────────────────────────────────────────────────

interface SyncReqMsg {
  have: string[]; // ids the requester already has
}

interface SyncRespMsg {
  missing: WbEvent[]; // events the requester is missing
}

// Handle incoming SYNC_REQ: compute what the requester is missing, serve it.
async function handleSyncReq(from: string): Promise<void> {
  // For v1: serve the full log (simple, works for small form counts).
  // Future: RBSR delta (only send what they're missing).
  if (log.length === 0) return;

  // Send events in batches (avoid huge single messages)
  const BATCH = 20;
  for (let i = 0; i < log.length; i += BATCH) {
    const batch = log.slice(i, i + BATCH);
    for (const e of batch) {
      await publishEvent(e);
    }
  }
}

// ── Init: register sync handlers ──────────────────────────────────────────────

let initialized = false;

export function initSync(): void {
  if (initialized) return;
  initialized = true;

  onSyncReq(async (from: string) => {
    await handleSyncReq(from);
  });
}

// ── Periodic reconcile (every 30s) ────────────────────────────────────────────
// For v1: just re-send SYNC_REQ to trigger peers to serve us their log.
// Future: proper RBSR with fingerprints.

let reconcileTimer: any = null;

export function startReconcile(intervalMs = 30000): void {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(async () => {
    try {
      await sendSyncReq();
    } catch { /* offline */ }
  }, intervalMs);
}

export function stopReconcile(): void {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
}
