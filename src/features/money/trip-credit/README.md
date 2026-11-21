# Promotional trip credit

Staff record explicit goodwill or promotional grants and spend them on an existing eligible full-fare booking. This module owns grant/redemption transactions, scoped balance/history reads, advisory eligible-booking quotes, and capability-safe current coverage receipts. Consumers use `index.ts`.

Owners/managers grant; active staff redeem. The writer recomputes authoritative fare and checks live tenant identity, authorization, payment sources, and integer-safe balances under locks. Direct debit and the existing booking payment gate commit atomically. Replayed UUIDs require the same economic payload. No cash collection or provider charge occurs.

The first version refuses partial/mixed, package, course, provider-backed, tax/fee, rental, nitrox, charter, past or unconfirmed-identity fares. Existing cash refund guarantees are unchanged. Cancellation restores the promotional debit once; unsupported moves and fare increases refuse without changing evidence. Equal/lower-price participant corrections retain original coverage.

Schema and shared cancellation/coverage primitives remain in `src/db`; staff forms remain in `src/app`. Journal economic fields are immutable; standard audited identity merge may repoint the beneficiary. Export and erasure preserve anonymous financial evidence.

See [the decision](../../../../docs/architecture/decisions/20261116-promotional-trip-credit-ledger.md). PGlite lifecycle tests do not prove PostgreSQL contention; `store.postgres.test.ts` requires the existing CI database service and never starts one.
