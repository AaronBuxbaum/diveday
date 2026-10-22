# Setup request receipts

Sends one fixed acknowledgment for a saved public setup request. The public action schedules this
feature after the request is stored; the feature accepts only the saved request ID.

Decision: [20261021-setup-request-receipts](../../../docs/architecture/decisions/20261021-setup-request-receipts.md).

## Public surface

`sendSetupRequestReceipt(id)` is exported by `index.ts`. It claims the request through the database
module, rereads the claimed recipient, sends through the notification provider with one attempt,
and records the outcome. The app's receipt module is a thin adapter.

## Invariants

- The database claim commits before delivery and serializes the address cooldown and global cap.
- Submitted text and operator capabilities never enter the fixed receipt.
- Erasure before the final read cancels delivery; accepted or ambiguous delivery is never retried.
- Logs contain the request ID and bounded outcome codes, without recipients or exception text.

The schema and claim lifecycle live in `src/db/`. Pure outcome codes and fixed mail rendering live
in `src/lib/`. PostgreSQL tests beside this entry point retain the independent-session dispatch
races; CI selects feature-module PostgreSQL suites as well as database suites.
