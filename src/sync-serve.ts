// whisperbox-android — sync-serve logic (pure, testable).
//
// When a peer sends SYNC_REQ ("joiner asks for full log" — the v1 protocol,
// same as whisperbox_core), we serve our whole event log back. This module is
// the pure core of that serve, separated from app-state.ts so it's testable in
// node (no react-native / loam-transport deps).
//
// The one property that matters on a real device: mobile networks are flaky,
// and loam-transport's publishSealed() THROWS when the node isn't settled or a
// channel send fails. A naive `for (e of log) await publish(e)` aborts the whole
// serve on the first failure — the peer gets a partial/empty log, and (because
// the caller is fire-and-forget) it leaks an unhandled rejection. serveLog()
// never throws: a per-event publish failure is counted and skipped, the serve
// continues. That robustness is what test/sync-serve-test.mjs locks in.

import { WbEvent } from "./engine";

export type PublishFn = (event: WbEvent) => Promise<void>;

export interface ServeResult {
  total: number;   // events in the log
  served: number;  // events successfully published
  failed: number;  // events whose publish threw (skipped, serve continued)
}

// Serve the full log via publishFn. NEVER throws — a per-event publish failure
// is counted and skipped so one bad publish can't abort the serve. Returns a
// summary (the caller can log/telemetry it; a non-zero `failed` means the peer
// may still be missing events and will re-request on its next reconcile).
export async function serveLog(log: WbEvent[], publishFn: PublishFn): Promise<ServeResult> {
  let served = 0;
  let failed = 0;
  for (const e of log) {
    try {
      await publishFn(e);
      served++;
    } catch {
      failed++;
      // continue — one failed publish must not abort the serve
    }
  }
  return { total: log.length, served, failed };
}
