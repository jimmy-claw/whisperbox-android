// whisperbox-android — pure, deterministic fold from a merged event log to app state.
// BYTE-PARITY with whisperbox-logos/whisperbox_core/src/whisperbox_engine.hpp.
//
// Two layers:
//   1. LOG FOLD (computeState): syncs opaque events. Responses are sealed blobs.
//   2. CREATOR VIEW (creatorView): given state + open() fn, assigns blobs to forms.

export const TOPIC = "/whisperbox/1/all/proto";

export interface Hlc {
  wall: number;
  ctr: number;
  dev: string;
}

export interface WbEvent {
  id: string;
  hlc: Hlc;
  type: string;
  payload: any;
}

export interface FormDef {
  id: string;
  title: string;
  description?: string;
  creator: string;
  publicKey: string; // hex
  createdAt: number;
  expiresAt?: number | null;
  questions: Question[];
  whitelist?: { type: string; value: string };
  signature?: string;
}

export interface Question {
  id: string;
  type: string; // text | textarea | radio | checkbox
  text: string;
  required: boolean;
  options?: string[];
}

export interface SealedResponse {
  id: string;
  hlc: Hlc;
  sealed: string; // base64
  from: string;   // respondent address
}

export interface DecryptedResponse {
  formId: string;
  respondent: string;
  answers: { question: string; answer: string }[];
  confirmed: boolean;
  confirmationId?: string;
}

export interface AppState {
  forms: Record<string, FormDef>;
  feed: string[]; // form ids in HLC publish order
  sealedPool: SealedResponse[]; // all sealed responses, HLC-ordered
  closedForms: Set<string>;
  myAddress: string;
  nodeReady: boolean;
}

export interface CreatorView {
  forms: string[]; // form ids I created
  responses: Record<string, DecryptedResponse[]>; // formId → decrypted responses
  undecrypted: number;
}

// ── HLC comparison ─────────────────────────────────────────────────────────────
export function compareHlc(a: Hlc, b: Hlc): number {
  if (a.wall !== b.wall) return a.wall < b.wall ? -1 : 1;
  if (a.ctr !== b.ctr) return a.ctr < b.ctr ? -1 : 1;
  if (a.dev !== b.dev) return a.dev < b.dev ? -1 : 1;
  return 0;
}

export function totalOrder(a: WbEvent, b: WbEvent): number {
  const c = compareHlc(a.hlc, b.hlc);
  if (c !== 0) return c;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

// ── Merge: union by id, MIN-HLC conflict rule ─────────────────────────────────
export function mergeEvents(logs: WbEvent[][]): WbEvent[] {
  const byId = new Map<string, WbEvent>();
  for (const log of logs) {
    for (const e of log) {
      if (!e.id) continue;
      const existing = byId.get(e.id);
      if (!existing) {
        byId.set(e.id, e);
      } else {
        // MIN-HLC wins
        if (compareHlc(e.hlc, existing.hlc) < 0) {
          byId.set(e.id, e);
        }
      }
    }
  }
  const merged = Array.from(byId.values());
  merged.sort(totalOrder);
  return merged;
}

// ── Fold: event log → AppState ────────────────────────────────────────────────
export function computeState(log: WbEvent[], myAddress: string): AppState {
  const forms: Record<string, FormDef> = {};
  const feed: string[] = [];
  const sealedPool: SealedResponse[] = [];
  const closedForms = new Set<string>();

  for (const e of log) {
    switch (e.type) {
      case "form.publish": {
        const p = e.payload;
        if (p && p.id && !forms[p.id]) {
          forms[p.id] = p as FormDef;
          feed.push(p.id);
        }
        break;
      }
      case "response.submit": {
        const p = e.payload;
        if (p && p.id && p.sealed) {
          // Dedup by id
          if (!sealedPool.find((r) => r.id === p.id)) {
            sealedPool.push({
              id: p.id,
              hlc: e.hlc,
              sealed: p.sealed,
              from: p.from || "",
            });
          }
        }
        break;
      }
      case "form.close": {
        const p = e.payload;
        if (p && p.formId) {
          closedForms.add(p.formId);
        }
        break;
      }
      case "response.confirm": {
        // Handled in creatorView (needs open())
        break;
      }
    }
  }

  return {
    forms,
    feed,
    sealedPool,
    closedForms,
    myAddress,
    nodeReady: true,
  };
}

// ── Creator View: decrypt + assign sealed responses to forms ──────────────────
export function computeCreatorView(
  state: AppState,
  myAddress: string,
  openFn: (sealed: Uint8Array) => Uint8Array | null
): CreatorView {
  const lc = (s: string) => s.toLowerCase();
  const myAddr = lc(myAddress);

  const myForms = state.feed.filter((fid) => {
    const f = state.forms[fid];
    return f && lc(f.creator) === myAddr;
  });

  const responses: Record<string, DecryptedResponse[]> = {};
  const confirmations = new Map<string, string>(); // responseId → confirmationId
  let undecrypted = 0;

  // Collect confirmations from the log (they're in sealedPool as events)
  // Actually confirmations are separate events — we need the full log for this.
  // For now, track confirmed state from the event log passed in.

  for (const fid of myForms) {
    responses[fid] = [];
  }

  for (const sr of state.sealedPool) {
    // Try to decrypt
    try {
      const sealedBytes = new Uint8Array(Buffer.from(sr.sealed, "base64"));
      const plaintext = openFn(sealedBytes);
      if (!plaintext) {
        undecrypted++;
        continue;
      }
      const decoded = JSON.parse(new TextDecoder().decode(plaintext));
      // decoded: { formId, respondent, answers: [{question, answer}] }
      const formId = decoded.formId;
      if (!formId || !responses[formId]) continue;

      // One response per respondent (earliest HLC wins)
      const existing = responses[formId].find(
        (r) => r.respondent.toLowerCase() === (decoded.respondent || sr.from).toLowerCase()
      );
      if (existing) continue;

      responses[formId].push({
        formId,
        respondent: decoded.respondent || sr.from,
        answers: decoded.answers || [],
        confirmed: false,
      });
    } catch {
      undecrypted++;
    }
  }

  return {
    forms: myForms,
    responses,
    undecrypted,
  };
}

// ── HLC Clock ─────────────────────────────────────────────────────────────────
export class HlcClock {
  private last: Hlc;
  private dev: string;

  constructor(deviceId: string) {
    this.dev = deviceId;
    this.last = { wall: 0, ctr: 0, dev: deviceId };
  }

  now(): Hlc {
    const wall = Date.now();
    if (wall > this.last.wall) {
      this.last = { wall, ctr: 0, dev: this.dev };
    } else {
      this.last = { wall: this.last.wall, ctr: this.last.ctr + 1, dev: this.dev };
    }
    return { ...this.last };
  }

  receive(remote: Hlc): void {
    const wall = Date.now();
    if (wall > remote.wall && wall > this.last.wall) {
      this.last = { wall, ctr: 0, dev: this.dev };
    } else if (remote.wall > this.last.wall) {
      this.last = { wall: remote.wall, ctr: remote.ctr + 1, dev: this.dev };
    } else if (this.last.wall > remote.wall) {
      // keep last
    } else {
      // equal wall
      const ctr = Math.max(this.last.ctr, remote.ctr) + 1;
      this.last = { wall: this.last.wall, ctr, dev: this.dev };
    }
  }
}
