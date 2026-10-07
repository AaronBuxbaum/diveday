# H-29: shopHasAdjudicated (src/lib/trip-admission.ts) triggers on a verified certification only, contradicting its own stated rationale.

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

`shopHasAdjudicated` (`src/lib/trip-admission.ts`) triggers on a **`verified`** certification only, contradicting its own stated rationale. Its job is to answer "is this diver unknown to the shop?", and it is what implements H-08's fail-open blast-radius promise. But a diver with three staff-entered `pending` cards is not unknown — a staffer typed each one — yet the gate reads them as a stranger and admits them onto anything. The reviewer proposes **"any non-archived certification row"**, which preserves the H-08 argument exactly (a shop that has never carded a diver still has zero rows, so every new customer still books) while closing the blindness. Counter-argument to weigh: the `verified` marker is also what makes "the record can be relied on" true, and a shop mid-backfill may hold many pending rows it has not stood behind.

## Minimum outcome to record

Whether "known to the shop" means any certification row on file, or only a verified one.

## Unblocks / follow-up

**Decided and implemented 2026-08-20: any live certification row.** `shopHasAdjudicated` no longer reads `status` at all — the question it asks is "is this diver unknown to us?", and a diver with three staff-typed cards is not unknown. H-08's fail-open promise never rested on the `verified` marker: zero rows still admits, so every genuinely new customer still books. Rides with H-27's ADR.

Part of the [human decision log](README.md#decision-register).
