# WhisperBox Android — Architecture

## Overview

Privacy-first encrypted forms for Android. Wire-compatible with the desktop
`whisperbox-logos` C++ core. Single shared Waku topic, ECIES on response payloads.

## Stack

| Layer | Tech | Notes |
|-------|------|-------|
| UI | React Native (Expo) | Indigo/charcoal palette, sidebar + main pane |
| State | Custom observable store | `app-state.ts` — subscribe/notify pattern |
| Sync | loam-sync (TS) | Event log, merge, reconcile, catchup |
| Transport | loam-transport (native) | SDS channels + BLE mesh. Mock for Expo Go |
| Crypto | @noble/curves + @noble/ciphers | ECIES: secp256k1 ECDH + HKDF + ChaCha20-Poly1305 |
| Storage | AsyncStorage + SecureStore | Event log + identity keypair |

## File Structure

```
whisperbox-android/
├── App.tsx              # Main UI (sidebar + form detail + overlays)
├── index.js             # Expo entry point
├── app.json             # Expo config
├── src/
│   ├── crypto.ts        # ECIES seal/open (byte-parity with C++)
│   ├── encoding.ts      # base64 + hex helpers (RN-compatible, no Buffer)
│   ├── engine.ts        # Fold: event log → AppState + CreatorView
│   ├── identity.ts      # Device identity (secp256k1 in SecureStore)
│   ├── app-state.ts     # State manager (wires everything together)
│   ├── mock-transport.ts # In-memory transport for Expo Go / UI dev
│   ├── sync.ts          # Sync adapter (event store, catchup, reconcile)
│   └── transport.ts     # Real loam-transport adapter (native build only)
├── test/
│   └── parity-test.mjs  # ECIES byte-parity test vs C++ golden vectors
└── docs/
    └── ARCHITECTURE.md  # This file
```

## Protocol

Single shared topic: `/whisperbox/1/all/proto`

Wire format: plain JSON envelopes (NO transport-level AEAD).
Privacy = ECIES on response payloads only. Form feed is public by design.

```
{v:1, type:"EVENT", event:{id, hlc, type, payload}}
{v:1, type:"SYNC_REQ", from:<deviceId>}
```

| Event type | Who | Payload |
|---|---|---|
| `form.publish` | creator | FormDef (title, questions, publicKey, ...) |
| `response.submit` | respondent | `{id, sealed (base64 ECIES), from}` |
| `response.confirm` | creator | `{formId, confirmationId, author}` |
| `form.close` | creator | `{formId, expiresAt}` |

## ECIES (byte-parity with C++)

```
seal(plaintext, recipientPub):
  ephPriv  = 32B CSPRNG
  ephPub   = secp256k1(ephPriv) compressed 33B
  Sx       = X-coord of ECDH(ephPriv, recipientPub)
  K        = HKDF-SHA256(Sx, salt="whisperbox-ecies-v1", L=32)
  nonce    = 12B CSPRNG
  aad      = recipientPub(33) || ephPub(33)
  return   = 0x01 || ephPub || nonce || ChaCha20-Poly1305(K, nonce, pt, aad)

open(sealed, privKey):
  parse ephPub, nonce, ct from sealed
  Sx       = X-coord of ECDH(privKey, ephPub)
  K        = HKDF-SHA256(Sx, salt="whisperbox-ecies-v1", L=32)
  aad      = myPub(33) || ephPub(33)
  return   = ChaCha20-Poly1305_decrypt(K, nonce, ct, aad)
```

Identity: `address = "0x" + hex(sha256(pub_compressed))[12..32]` (last 20 bytes)

## Transport Modes

| Mode | When | How |
|------|------|-----|
| Mock | Expo Go, UI dev | `mock-transport.ts` — in-memory, no native deps |
| Real | Native build | `transport.ts` — loam-transport (SDS + BLE mesh) |

To switch: change the import in `app-state.ts` from `./mock-transport` to `./transport`.

## Build

### Prerequisites
- Node 18 or 20 (NOT 22 — Expo 52 incompatibility)
- Android SDK + emulator (or physical device)
- For real transport: loam-transport native modules + liblogosdelivery.so

### Expo Go (UI testing, mock transport)
```bash
npm install
npx expo start
# Scan QR with Expo Go app
```

### Native build (real transport)
```bash
# 1. Prebuild native project
npx expo prebuild --platform android

# 2. Add loam-transport native modules
#    (copy from loam-transport/native/ into android/app/src/main/)

# 3. Add liblogosdelivery.so
#    (from loam-transport or build from logos-delivery-module)

# 4. Build
cd android && ./gradlew assembleDebug
```

### Parity test
```bash
npx tsx test/parity-test.mjs
# 18/18 passed = byte-identical with C++
```

## Keycard Identity (planned)

Currently uses a locally-generated secp256k1 keypair stored in SecureStore.
Future: integrate Keycard for hardware-backed identity (same as loam/scala).
The `Identity` interface is already abstracted — just swap the derivation source.

## Differences from Desktop (whisperbox-logos)

| Aspect | Desktop (C++) | Android (TS) |
|--------|---------------|--------------|
| Transport | delivery_module (C++ JNI) | loam-transport (RN native) |
| Storage | SQLite (via core) | AsyncStorage (JSON) |
| Identity | CSPRNG + file | SecureStore |
| QR | Canvas (QML) | (planned: react-native-qrcode) |
| CSV export | File system | (planned: react-native-fs) |
| Engine | whisperbox_engine.hpp | engine.ts (same fold logic) |
| Crypto | OpenSSL | @noble (pure JS, same output) |
