// Type declarations for loam-transport (file dependency, source not type-checked)
declare module "loam-transport" {
  export type NodeMode = "Core" | "Edge";
  export type OnReceive = (topic: string, candidates: Uint8Array[]) => boolean;
  export type OnStatus = (s: string) => void;

  export function setNodeMode(m: NodeMode): void;
  export function getNodeMode(): NodeMode;
  export function preferServiceBackend(on: boolean, appId?: string): void;
  export function start(opts: {
    deviceId: string;
    topics: string[];
    onReceive: OnReceive;
    onStatus?: OnStatus;
  }): Promise<void>;
  export function stop(): Promise<void>;
  export function publishSealed(topic: string, sealed: Uint8Array): Promise<void>;
  export function publishRaw(topic: string, sealed: Uint8Array): Promise<void>;
  export function storeSync(onCandidates: (topic: string, candidates: Uint8Array[]) => boolean): Promise<{ msgs: number; events: number; detail: string }>;
  export function join(topics: string[]): Promise<void>;
  export function refreshPeerInfo(): Promise<void>;
  export function refreshDebug(): Promise<void>;
  export function usingServiceBackend(): boolean;
  export function serviceNodeDown(): boolean;
  export function serviceAwaitingApproval(): boolean;
  export function launchSharedService(): void;
  export function serviceDiag(): Promise<string>;
  export function deliveryAvailable(): boolean;
  export function getStoreInfo(): string;
  export function getCtx(): string;
  export function shardFor(contentTopic: string, count?: number): number;
  export function payloadCandidates(payload: any): Uint8Array[];
  export const counters: any;
  export const diag: any;
  export const ENTRY_NODES: string[];
}
