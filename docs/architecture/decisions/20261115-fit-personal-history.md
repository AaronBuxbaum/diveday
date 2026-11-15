# 20261115-fit-personal-history — Decode personal FIT history with Garmin’s SDK

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

[Personal computer evidence](20261115-personal-computer-evidence.md) accepts files without
changing shared dive evidence, readiness, recency, no-fly, or any operational safety input.
FIT is binary and requires format integrity, message association and unit validation.
[Aaron’s import request](https://github.com/AaronBuxbaum/diveday/pull/4532) requires the official
SDK and representative, redistribution-authorized fixtures before claiming compatibility.

## Decision

Pin the stable `@garmin/fitsdk` 21.221.0 release for internal server-side parsing. Its 2026-11-03
publication predates the package policy’s one-day minimum release age. Preserve the package’s
[FIT Protocol License](https://github.com/garmin/fit-javascript-sdk/blob/21.221.0/LICENSE.txt).
Garmin’s FIT team [clarifies server application use](https://forums.garmin.com/developer/fit-sdk/f/discussion/446511/commercial-server-side-use-of-garmin-fitsdk-in-a-saas-application).
The SDK stays outside operational safety systems and is not exposed as a standalone service.

Verify header, length and CRC before decoding. Bound file bytes and decoded messages/samples;
reject ambiguous session association and unsupported message structures rather than guessing.
Normalize the SDK’s scaled SI values. Keep the FIT UTC instant independently of the original
local wall clock and offset, which may both be unknown. Staff cannot reinterpret that instant
by entering an offset for an absent wall clock.

Use the MIT-licensed, anonymized Garmin Descent/Connect summary-first fixture pinned and
attributed in the parser fixture README. That fixture establishes one export shape, not every
Garmin device, configuration or export. UDDF and Subsurface remain synthetic-fixture format
subsets; no Oceanic+ or Shearwater compatibility claim follows from their export documentation.

## Alternatives considered

- **Independent FIT decoder** — conflicts with the requested official adapter and adds another
  protocol implementation to audit.
- **Synthetic FIT files alone** — useful for adversarial tests, insufficient for vendor claims.
- **SDK in the browser** — unnecessary client cost and broader distribution; parsing belongs
  behind live tenant and role authorization.

## Consequences

A verified FIT export can join the existing preview, confirmation and reversible history flow.
Raw files are still discarded. Profiles, gases and source provenance are preserved; unsupported
telemetry is explicitly warned about, never turned into a safety calculation.

Revisit if Garmin’s license or supported API changes, the fixture’s redistribution status is
withdrawn, or another export needs association rules this adapter cannot prove. Removing the
adapter and dependency leaves already-normalized personal evidence portable in JSON; no
operational data migration is needed.
