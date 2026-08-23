# WhisperBox Android

Privacy-first encrypted forms for Android. Built on the Logos stack.

## Architecture

```
whisperbox-android (this repo)
├── app/              Expo/RN app (UI + state)
├── src/
│   ├── crypto.ts     ECIES (secp256k1 ECDH + HKDF + ChaCha20-Poly1305)
│   ├── sync.ts       loam-sync adapter (merge, reconcile, catchup)
│   ├── transport.ts  loam-transport adapter (topic, envelope dispatch)
│   ├── engine.ts     fold: event log → app state (forms, responses, creatorView)
│   └── identity.ts   device identity (secp256k1 keypair)
└── docs/
    └── ARCHITECTURE.md
```

## Dependencies

- [loam-transport](https://github.com/vpavlin/loam-transport) — wire (SDS channels + BLE mesh)
- [loam-sync](https://github.com/vpavlin/loam-sync) — event log (merge, reconcile, catchup)
- [whisperbox-logos](https://github.com/vpavlin/whisperbox-logos) — protocol reference (C++ core)

## Protocol

Single shared topic: `/whisperbox/1/all/proto`

| event | who | notes |
|---|---|---|
| `form.publish` | creator | public form def + creator signature |
| `response.submit` | respondent | ECIES-sealed to form key |
| `response.confirm` | creator | plaintext receipt echo |
| `form.close` | creator | sticky close |

Wire: plain JSON envelopes (no transport AEAD). Privacy = ECIES on response payloads.

## Build

```bash
npm install
npx expo start
```
