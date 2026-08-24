// whisperbox-android — app state manager.
// Local-first: identity + log load immediately, node connects in background.
// Uses loam-transport (real Waku mesh) with Edge mode for embedded node.

import { getIdentity } from "./identity";
import * as loam from "loam-transport";
import { envEvent, envSyncReq, openCandidate } from "./envelope";
import { serveLog } from "./sync-serve";
import { appendEvent, getLog, initSync, startReconcile, stopReconcile, setSendSyncReq } from "./sync";
import {
  WbEvent, HlcClock, computeState, computeCreatorView,
  AppState, CreatorView, FormDef, Question, TOPIC,
} from "./engine";
import { seal, open, Identity, pubKeyFromHex } from "./crypto";
import { bytesToBase64, base64ToBytes } from "./encoding";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "whisperbox-log";
const NODE_MODE_KEY = "whisperbox-node-mode";

// ── Node mode ─────────────────────────────────────────────────────────────────

export type NodeMode = "shared" | "embedded";

let nodeMode: NodeMode = "embedded";

export async function getSavedNodeMode(): Promise<NodeMode | null> {
  try {
    const v = await AsyncStorage.getItem(NODE_MODE_KEY);
    return v === "shared" || v === "embedded" ? v : null;
  } catch { return null; }
}

export async function saveNodeMode(mode: NodeMode): Promise<void> {
  nodeMode = mode;
  await AsyncStorage.setItem(NODE_MODE_KEY, mode);
}

// ── State ─────────────────────────────────────────────────────────────────────

let identity: Identity | null = null;
let clock: HlcClock | null = null;
let state: AppState | null = null;
let creatorView: CreatorView | null = null;
let status = "initializing";
let nodeStatus = "disconnected";
let listeners: (() => void)[] = [];

export function getState(): {
  state: AppState | null;
  creatorView: CreatorView | null;
  status: string;
  nodeStatus: string;
  identity: Identity | null;
  nodeMode: NodeMode;
} {
  return { state, creatorView, status, nodeStatus, identity, nodeMode };
}

export function subscribe(fn: () => void): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

function notify(): void {
  listeners.forEach((fn) => fn());
}

// ── Fold + creator view update ────────────────────────────────────────────────

function refold(): void {
  if (!identity) return;
  const log = getLog();
  state = computeState(log, identity.address);
  state.nodeReady = nodeStatus === "connected";

  const openFn = (sealed: Uint8Array): Uint8Array | null => {
    try {
      return open(sealed, identity!.privKey);
    } catch {
      return null;
    }
  };
  creatorView = computeCreatorView(state, identity.address, openFn);
  notify();
}

// ── Event ingestion ───────────────────────────────────────────────────────────

function onWbEvent(e: WbEvent): void {
  if (!clock) return;
  clock.receive(e.hlc);
  appendEvent(e);
  refold();
  persistLog();
}

// ── Sync handlers ─────────────────────────────────────────────────────────────

// Serve our full log to a peer that sent SYNC_REQ. Uses serveLog() so a flaky
// network (publishSealed throws when the node isn't settled) can't abort the
// serve or leak an unhandled rejection — see src/sync-serve.ts.
async function handleSyncReq(_from: string): Promise<void> {
  const log = getLog();
  if (log.length === 0) return;
  await serveLog(log, publishEvent);
}

async function sendSyncReq(): Promise<void> {
  if (!identity) return;
  const text = envSyncReq(identity.address.slice(2, 10));
  const bytes = new TextEncoder().encode(text);
  await loam.publishSealed(TOPIC, bytes);
}

// ── Transport wiring ──────────────────────────────────────────────────────────

let transportStarted = false;

function wireTransport(): void {
  loam.start({
    deviceId: identity!.address.slice(2, 10),
    topics: [TOPIC],
    onReceive: (topic: string, candidates: Uint8Array[]): boolean => {
      for (const cand of candidates) {
        const env = openCandidate(cand);
        if (!env) continue;
        if (env.type === "EVENT" && env.event) {
          onWbEvent(env.event);
          return true;
        }
        if (env.type === "SYNC_REQ") {
          handleSyncReq(env.from || "");
          return true;
        }
      }
      return false;
    },
    onStatus: (s: string) => {
      if (s === "Connected" || s === "Connected (shared node)") {
        nodeStatus = "connected";
      } else if (s.includes("unavailable") || s.includes("error")) {
        nodeStatus = "error";
      } else {
        nodeStatus = "connecting";
      }
      status = nodeStatus === "connected" ? "ready" : "connecting";
      refold();
      notify();
    },
  }).then(() => {
    transportStarted = true;

    // Cold-start: pull history
    loam.storeSync((topic: string, candidates: Uint8Array[]): boolean => {
      for (const cand of candidates) {
        const env = openCandidate(cand);
        if (env && env.type === "EVENT" && env.event) {
          onWbEvent(env.event);
          return true;
        }
      }
      return false;
    }).catch(() => { /* offline */ });

    // Send SYNC_REQ
    sendSyncReq().catch(() => { /* offline */ });

    // Wire reconcile
    setSendSyncReq(sendSyncReq);
    startReconcile();
  }).catch((e: any) => {
    nodeStatus = "error: " + (e?.message || String(e)).slice(0, 60);
    status = "ready (offline)";
    notify();
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export async function init(): Promise<void> {
  status = "loading identity";
  notify();

  identity = await getIdentity();
  const deviceId = identity.address.slice(2, 10);
  clock = new HlcClock(deviceId);

  status = "loading log";
  notify();

  // Load persisted log
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      const events: WbEvent[] = JSON.parse(stored);
      const { setLog } = require("./sync");
      setLog(events);
    }
  } catch { /* first run */ }

  // Load saved node mode
  const saved = await getSavedNodeMode();
  if (saved) nodeMode = saved;

  // LOCAL-FIRST: app is ready immediately with local data
  status = "ready";
  refold();
  notify();

  // Start node in background (non-blocking)
  startNode();
}

async function startNode(): Promise<void> {
  if (!identity || transportStarted) return;

  nodeStatus = "connecting";
  status = "connecting";
  notify();

  // Configure loam-transport based on node mode
  if (nodeMode === "shared") {
    loam.preferServiceBackend(true, "whisperbox");
  } else {
    loam.preferServiceBackend(false);
    loam.setNodeMode("Edge"); // Edge mode: light, mobile-friendly
  }

  wireTransport();
}

export async function switchNodeMode(mode: NodeMode): Promise<void> {
  await saveNodeMode(mode);
  await loam.stop().catch(() => {});
  transportStarted = false;
  nodeStatus = "disconnected";
  startNode();
}

export async function shutdown(): Promise<void> {
  stopReconcile();
  await loam.stop().catch(() => {});
  transportStarted = false;
  status = "stopped";
  notify();
}

// ── Actions ───────────────────────────────────────────────────────────────────

export async function createForm(title: string, description: string, questions: Question[]): Promise<string> {
  if (!identity || !clock) throw new Error("not initialized");

  const formId = "form-" + Math.random().toString(16).slice(2, 10);
  const form: FormDef = {
    id: formId,
    title,
    description,
    creator: identity.address,
    publicKey: identity.pubHex,
    createdAt: Date.now(),
    expiresAt: null,
    questions,
    whitelist: { type: "none", value: "" },
  };

  const event: WbEvent = {
    id: `publish-${formId}`,
    hlc: clock.now(),
    type: "form.publish",
    payload: form,
  };

  appendEvent(event);
  refold();
  persistLog();
  publishEvent(event).catch(() => { /* will retry on reconcile */ });
  return formId;
}

// Local-first edit: overwrite a form you created. Applied to local state immediately,
// published in the background (works fully offline).
export async function updateForm(formId: string, updates: Partial<FormDef>): Promise<void> {
  if (!identity || !clock || !state) throw new Error("not initialized");
  const existing = state.forms[formId];
  if (!existing) throw new Error("form not found");
  if (existing.creator.toLowerCase() !== identity.address.toLowerCase()) throw new Error("not your form");

  const updated: FormDef = { ...existing, ...updates, id: formId, creator: existing.creator, publicKey: existing.publicKey };
  const event: WbEvent = {
    id: `update-${formId}-${Date.now()}`,
    hlc: clock.now(),
    type: "form.update",
    payload: updated,
  };

  appendEvent(event);
  refold();
  persistLog();
  publishEvent(event).catch(() => { /* retry later */ });
}

export async function submitResponse(formId: string, answers: { question: string; answer: string }[]): Promise<void> {
  if (!identity || !clock || !state) throw new Error("not initialized");

  const form = state.forms[formId];
  if (!form) throw new Error("form not found");

  const creatorPub = pubKeyFromHex(form.publicKey);
  const plaintext = JSON.stringify({
    formId,
    respondent: identity.address,
    answers,
  });
  const sealed = seal(new TextEncoder().encode(plaintext), creatorPub);
  const sealedB64 = bytesToBase64(sealed);

  const respId = `resp-${formId}-${identity.address.slice(2, 8)}-${Date.now()}`;
  const event: WbEvent = {
    id: respId,
    hlc: clock.now(),
    type: "response.submit",
    payload: {
      id: respId,
      sealed: sealedB64,
      from: identity.address,
    },
  };

  appendEvent(event);
  refold();
  persistLog();
  publishEvent(event).catch(() => { /* retry later */ });
}

export async function closeForm(formId: string): Promise<void> {
  if (!identity || !clock) throw new Error("not initialized");

  const event: WbEvent = {
    id: `close-${formId}-${Date.now()}`,
    hlc: clock.now(),
    type: "form.close",
    payload: { formId },
  };

  appendEvent(event);
  refold();
  persistLog();
  publishEvent(event).catch(() => {});
}

// ── Publish (background, non-blocking) ────────────────────────────────────────

async function publishEvent(event: WbEvent): Promise<void> {
  const text = envEvent(event);
  const bytes = new TextEncoder().encode(text);
  await loam.publishSealed(TOPIC, bytes);
}

// ── Persistence ───────────────────────────────────────────────────────────────

let persistTimer: any = null;

function persistLog(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    try {
      const log = getLog();
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(log));
    } catch { /* storage full? */ }
  }, 1000);
}
