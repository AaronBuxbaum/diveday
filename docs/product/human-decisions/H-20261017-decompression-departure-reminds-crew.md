# H-20261017-decompression-departure-reminds-crew: Does a decompression departure warn about technical cards, or gate on them?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**A departure marked as past no-decompression limits (`trips.exceeds_no_deco_limits`, H-20260916-may-diveday-assert-about) books and boards an Open Water diver or a junior with no word anywhere. Should DiveDay warn, gate at boarding, or leave it to the shop's minimum-certification setting?** Issue #2384 offered three options: (a) leave it, (b) warn on the roster and roll call when a booked diver holds no decompression-capable card, (c) gate at boarding through `readiness.ts`, with `trip-admission.ts` no stricter.

## Decision

**Decided 2026-10-17 (Product owner: Aaron Buxbaum, on issue #2384): (b), warn now.** An advisory, never a block. Gating, and a per-diver warning, wait for a dive professional to confirm which cards qualify.

## What shipped, and why it is one line

DiveDay stores no technical or decompression card: `certification_level` is the recreational ladder (Open Water to Instructor), `dive_specialty` is deep, wreck, night, drysuit and cavern, and the importer declines tec, deco, trimix and extended-range cards by name. A per-diver predicate would flag every diver, which says nothing. So the warning is one line per departure, shown on the staff roster, the roll call, the printed packet and the offline copy when the departure is marked and someone aboard dives (a booked diver whose seat is still held, or a guide in the water) (`needsDecompressionCardReminder`, `src/lib/decompression-reminder.ts`): check each diver's and guide's decompression card, because DiveDay does not record it. It shows at the dock checkpoint only, never on a finished departure's record. A boat of snorkelers and riders reads nothing, as the depth advisory does.

`readiness.ts` and `trip-admission.ts` are unchanged. The recap's flying sentence is unchanged.

## Still open

A technical-card model (a way to record a decompression or technical card, captured and verified like the others) and an agency card list a dive professional signs off. Both come before a per-diver warning or a readiness blocker. Issue #2384 stays open for them.

## Unblocks / follow-up

H-20260916-may-diveday-assert-about (the flag), H-20260724-certification-levels-agency-rules (a warning, never a gate, for depth).
