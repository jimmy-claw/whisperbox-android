// whisperbox-android — app state manager.
// Wires together: identity + transport + sync + engine.
// Exposes a simple observable state for the React Native UI.

import { getIdentity } from "./identity";
import { startNode, stopNode, publishEvent, storeSync, onEvent, onStatus, getPeerCount } from "./transport";
import { initSync, appendEvent, getLog, startReconcile, stopReconcile } from "./sync";
import {
  WbEvent, HlcClock, computeState, computeCreatorView,
  AppState, CreatorView, FormDef, Question, TOPIC,
} from "./engine";
import { seal, open, Identity, pubKeyFromAddress } from "./crypto";
import * as AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "whisperbox-log";

// ── State ─────────────────────────────────────────────────────────────────────

let identity: Identity | null = null;
let clock: HlcClock | null = null;
let state: AppState | null = null;
let creatorView: CreatorView | null = null;
let status = "initializing";
let listeners: (() => void)[] = [];

export function getState(): { state: AppState | null; creatorView: CreatorView | null; status: string; identity: Identity | null } {
  return { state, creatorView, status, identity };
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

  // Creator view: try to decrypt responses with our key
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

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export async function init(): Promise<void> {
  status = "loading identity";
  notify();

  identity = await getIdentity();
  const deviceId = identity.address.slice(2, 10); // short device id
  clock = new HlcClock(deviceId);

  status = "loading log";
  notify();

  // Load persisted log
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      const events: WbEvent[] = JSON.parse(stored);
      // Set log without triggering refold yet
      const { setLog } = require("./sync");
      setLog(events);
    }
  } catch { /* first run */ }

  status = "starting node";
  notify();

  // Register event handler BEFORE starting node
  onEvent(onWbEvent);
  onStatus((s: string) => { status = s; notify(); });

  initSync();
  await startNode(identity, deviceId);

  // Cold-start: pull history from fleet store
  status = "syncing history";
  notify();
  try {
    await storeSync();
  } catch { /* offline */ }

  // Send SYNC_REQ to trigger peers to serve us
  try {
    const { sendSyncReq } = require("./transport");
    await sendSyncReq();
  } catch { /* offline */ }

  // Start periodic reconcile
  startReconcile();

  status = "ready";
  refold();
  notify();
}

export async function shutdown(): Promise<void> {
  stopReconcile();
  await stopNode();
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
    publicKey: Buffer.from(identity.pubKey).toString("hex"),
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
  await publishEvent(event);
  return formId;
}

export async function submitResponse(formId: string, answers: { question: string; answer: string }[]): Promise<void> {
  if (!identity || !clock || !state) throw new Error("not initialized");

  const form = state.forms[formId];
  if (!form) throw new Error("form not found");

  // ECIES-seal the response to the form creator's public key
  const creatorPub = pubKeyFromAddress(form.publicKey);
  const plaintext = JSON.stringify({
    formId,
    respondent: identity.address,
    answers,
  });
  const sealed = seal(new TextEncoder().encode(plaintext), creatorPub);
  const sealedB64 = Buffer.from(sealed).toString("base64");

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
  await publishEvent(event);
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
  await publishEvent(event);
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
