// whisperbox-android — sync adapter.
// Handles: reconcile (periodic SYNC_REQ), event store.
// Transport is loam-transport (real Waku mesh).

import { WbEvent, totalOrder } from "./engine";

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

// ── Init ──────────────────────────────────────────────────────────────────────

let initialized = false;

export function initSync(): void {
  if (initialized) return;
  initialized = true;
  // Sync handlers are registered in app-state.ts via loam-transport's onReceive
}

// ── Periodic reconcile ────────────────────────────────────────────────────────

let reconcileTimer: any = null;
let sendSyncReqFn: (() => Promise<void>) | null = null;

export function setSendSyncReq(fn: () => Promise<void>): void {
  sendSyncReqFn = fn;
}

export function startReconcile(intervalMs = 30000): void {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(async () => {
    try {
      if (sendSyncReqFn) await sendSyncReqFn();
    } catch { /* offline */ }
  }, intervalMs);
}

export function stopReconcile(): void {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
}
