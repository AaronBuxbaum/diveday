# DO NOT MERGE: lock-order experiment for #4474

This branch is an experiment, not a complete or safe receipt protocol. It changes ordinary staff and demo operations if deployed. Do not merge, deploy, enable capture, or use it as proof of safe handoff.

The named manual reset, preview, canonical refresh, today-nudge and staff mutation paths acquire the boarding-evidence fence before the demo shop identity lock. Independent security review found that this addresses the specific shop/evidence inversion in canonical refresh, but exposes another inversion: today-nudge holds the exclusive evidence fence before requesting the trip-revision fence, while coordinated dispatch can hold the trip-revision fence before requesting shared evidence. Photo writes also take trip dispatch before evidence. A shop-material lock can produce another inversion when enabled. These cycles need a globally consistent design and real PostgreSQL tests; they have not been resolved.

The exclusive fence can delay urgent revocation behind unrelated evidence work and still refuses timely intake during a held reset. Password/session revocation, erasure, moves, preview row locks, boat-at-sea writers, snapshot replay, multi-shop reap/cap, older servers and offline clients remain unaudited or uncoordinated. The original booking and generation are still deleted by reset; device evidence, authenticated receipt, late review, and erasure/replay ordering remain unproven. The existing held-reset and late-intake regressions are not modified.

Local existing staff-account tests passed (38 tests). Real PostgreSQL tests, full reset and browser tests, independent final domain/security review, and mixed-version safety remain required.
