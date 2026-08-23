// mock-transport.ts — in-memory transport for Expo Go / UI development.
// Simulates the Waku mesh with a local event loop. No native deps.
// Swap to real loam-transport for production builds.

import { WbEvent, TOPIC } from "./engine";

type OnEvent = (event: WbEvent) => void;
type OnStatus = (s: string) => void;

let eventHandlers: OnEvent[] = [];
let statusHandlers: OnStatus[] = [];
let syncReqHandlers: ((from: string) => void)[] = [];
let running = false;
let localLog: WbEvent[] = [];
let peerCount = 0;

// Simulated peers that will "receive" our events and send back some
const SIMULATED_PEERS = 2;

export function onEvent(fn: OnEvent): void {
  eventHandlers.push(fn);
}

export function onStatus(fn: OnStatus): void {
  statusHandlers.push(fn);
}

export function onSyncReq(fn: (from: string) => void): void {
  syncReqHandlers.push(fn);
}

export async function startNode(_identity: any, _deviceId: string): Promise<void> {
  running = true;
  peerCount = SIMULATED_PEERS;
  statusHandlers.forEach((fn) => fn("mock: connected"));

  // Simulate receiving some existing forms from the mesh after a short delay
  setTimeout(() => {
    if (!running) return;
    // In a real scenario, these would come from the Waku mesh
    // For now, just emit a status update
    statusHandlers.forEach((fn) => fn("mock: synced"));
  }, 1000);
}

export async function stopNode(): Promise<void> {
  running = false;
  statusHandlers.forEach((fn) => fn("mock: stopped"));
}

export async function publishEvent(event: WbEvent): Promise<void> {
  if (!running) throw new Error("node not running");
  // Store locally
  localLog.push(event);
  // In a real transport, this would go over Waku to all peers
  // For mock: just acknowledge locally
  console.log(`[mock-transport] published ${event.type} (${event.id})`);
}

export async function sendSyncReq(): Promise<void> {
  if (!running) return;
  console.log("[mock-transport] SYNC_REQ sent");
  // In a real scenario, peers would respond with their events
  // For mock: no-op
}

export async function storeSync(): Promise<number> {
  if (!running) return 0;
  console.log("[mock-transport] storeSync: no stored events");
  return 0;
}

export function getPeerCount(): number {
  return peerCount;
}

export function getShard(): number {
  return 0;
}

export function getLocalLog(): WbEvent[] {
  return localLog;
}
