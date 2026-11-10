# 20261110-native-wallet-passes — Sign native departure passes behind credential gates

- **Status:** Accepted
- **Date:** 2026-11-10

## Context

[#4218](https://github.com/AaronBuxbaum/diveday/issues/4218) implements slice 18f of
[20260907-nothing-from-nowhere](20260907-nothing-from-nowhere.md). The owner approved building
Apple and Google Wallet passes before obtaining credentials. The saved arrival card remains the
fallback; [#4208](https://github.com/AaronBuxbaum/diveday/issues/4208) owns account enrollment,
payment, certificates and issuer approval.

## Decision

Use **passkit-generator 3.5.8 (MIT)** to produce Apple's detached PKCS#7 signature and archive.
It brings node-forge, joi, do-not-zip and tslib; a narrow Joi 17.13.9 override removes the vendor-pinned version’s advisories. Bundle Apple's public WWDR G4 intermediate and
the existing bubble mark as pass-sized icons. Use Node's crypto and HTTP/2 for Google RS256,
OAuth and certificate-authenticated APNs, with bounded provider requests and no other dependency.

`wallet_passes` stores one snapshot per booking/platform, the issue locale, content hash and
delivery stamps. `wallet_pass_registrations` stores tenant-bound Apple device delivery addresses.
The ten-minute job reads the same departure, consented crew and recorded stage as the thread.
Only content changes publish updates; failed deliveries retry. `last_checked_at` gives bounded
scans a fair order. Registrations expire thirty days after their pass; pass rows follow erasure.

A random bearer token cannot be re-rendered from its hash. Derive Apple's per-pass token using
HKDF-SHA256 with a new `wallet-pass-auth-v1` purpose and HMAC over the pass's random UUID, under
the existing AUTH_SECRET. Store only SHA-256. This token cannot open a booking. An installed
pass presents its own token, so updates echo that authenticated token even after secret rotation.
An explicit re-add after rotation replaces the old pass and registrations. Erasure immediately
revokes downloads, voids and strips the stored diver name, and removes device registrations.
Generated crew names are conservatively cleared across tenant snapshots, including expired passes; only owned passes are voided. Scrubbed rows receive a final update. Snapshot writers share the existing person-rewrite fence with erasure, preventing stale name restoration. Already downloaded offline cards cannot be recalled.

Absent, partial or malformed credentials keep that platform dark. The default-on shop Features
switch hides new issue routes and links when off. Existing passes continue receiving changed and
cancelled facts; switching off never leaves an already issued departure frozen. PassKit's serial
list follows Apple's unauthenticated device-identifier protocol and returns only that device's
registered serials; registration and pass retrieval require pass-scoped authentication. Device
log bodies are discarded, never relayed into logs.

## Alternatives considered

- **Saved HTML only:** remains available, but cannot update a lock-screen pass.
- **Plaintext or encrypted bearer storage:** unnecessary when a purpose-separated derivation can
  support repeat downloads without placing reusable credentials in the database.
- **Google/APNs SDKs:** Node already supplies the required signing and transport primitives.

## Consequences

No live credential is committed, acquired or activated by this slice. Runtime-generated test
identities exercise signing and local flows. Real-device enrollment, revocation and delivery
rehearsals remain the human credential task. Revisit the library if maintained Apple signing
support or security fixes require it; replacing it changes the renderer, not stored snapshots.
