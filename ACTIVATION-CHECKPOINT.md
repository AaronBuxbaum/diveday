# Unsafe activation checkpoint

This branch is an incomplete local checkpoint, not a pull request or deployment candidate. The production-enabling change is unsafe until the boundaries below are resolved. No production state was changed.

- A real PostgreSQL regression reproduced an offline observation captured for one person being accepted after a diver merge repointed the booking. The local merge generation increment makes the two sequential order tests pass; concurrent lock ordering remains unverified.
- Source review found that hull/mode and meeting-location edits, booking cancellation/reactivation, and trip cancellation/reinstatement do not advance the relevant witness generation. Dive-plan edit/revert also needs a checkpoint-identity decision. These paths are not fixed here.
- Witness mode holds all offline crew marks and checklist events. There is no complete checklist resolution flow; safe routine marks do not all auto-sync.
- The production-mode gate test passes, but the protocol-2 refusal regression is intentionally red in the test fixture's disabled mode. The protocol change and dependent current-client tests are not finished.
- Existing unbound accepted evidence requires a safe, explicit treatment. Preserve the restore stop and do not infer identity or replay safety from a timestamp.

Tests: `/tmp/4787-merge-red.log` reproduces both orders; `/tmp/4787-merge-green.log` passes the sequential regression after the local merge change; `/tmp/4787-enable-protocol-red.log` records the remaining protocol refusal failure. No gated concurrency or CI has been run on this checkpoint.
