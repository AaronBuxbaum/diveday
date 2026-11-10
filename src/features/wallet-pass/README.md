# wallet-pass

Native Apple and Google departure passes for a booked diver, under
[ADR 20260907-nothing-from-nowhere](../../../docs/architecture/decisions/20260907-nothing-from-nowhere.md)
and [ADR 20261110-native-wallet-passes](../../../docs/architecture/decisions/20261110-native-wallet-passes.md).
The saved arrival card is always available. Incomplete or malformed platform credentials leave
native issue routes dark; no account or credential is provisioned by this module.

## Owns

- Safe, deterministic, localized content snapshots and their canonical hash.
- Idempotent issue, Apple PKCS#7 rendering, Google Save JWTs and provider updates.
- Pass-scoped authentication, device registration, conditional fetches and fair bounded scans.
- The erasure hook: void owned passes and remove their diver name; clear generated crew names across the tenant, including expired snapshots, without revoking unrelated divers.

## Does not own

- Booking authorization: native issue routes verify the readiness capability themselves.
- Account enrollment, issuer approval, payment or live credentials, tracked in #4208.
- Booking, readiness, capacity, check-in, revision writers or the crew's stage decisions.
- The saved arrival card, which remains the credential-free fallback.

## Public surface

`index.ts` is the whole public surface. Callers use its typed content builder, issue/render/save
functions, PassKit service, cron runner and erasure hook. Route adapters stay thin.

## May import

`@/lib/**`, `@/db/**` and other feature modules' public contracts. Never `@/app/**`.

## Invariants

- Content carries no capability, booking id, barcode, payment, waiver, medical or emergency fact.
- Names for an identity-held seat come from the booking's typed name, not the matched record.
- The locale is fixed at issue; all times name the shop's zone. Stages are recorded, never inferred.
- Only token hashes are stored. The derivation is purpose-separated from booking capabilities.
- AUTH_SECRET rotation does not invalidate a presented installed-pass token. Re-adding after
  rotation replaces the unrecoverable old token's row; deletion and erasure revoke it immediately.
- Existing passes continue to follow cancellation when the shop's Features switch is off.
- Refreshes commit current content even when provider delivery fails. The previous successful
  delivery stamp remains behind the new snapshot, so a later scan retries unchanged content.
  Snapshot timestamps advance monotonically, including changes within one clock tick.
- Apple's serial-list request has no Authorization header by protocol. The device identifier
  scopes it to live registrations. All writes and document fetches require the pass token.
- No provider error, device log body, push token, device identifier or signing key reaches logs.
- Registration retention is thirty days after expiration. Passes themselves have no age prune.

## Bundled assets

`assets/AppleWWDRCAG4.crt` is Apple's public G4 intermediate, downloaded from
https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer. It is not a signing identity.
The three icon PNGs render the existing LogoMark geometry at Apple's 29/58/87 pixel sizes.

`bundled-assets.ts` embeds the public source bytes for Node and Turbopack without runtime filesystem reads. The asset test pins it to those sources.

Snapshot writers take the existing shared person-rewrite fence before person/pass locks. Erasure clears crew fields conservatively because a former crew member’s chosen public alias may already have been removed; remaining consented crew are rebuilt from live sources on the next update. Scrubbed expired snapshots are marked pending delivery.
