# Offline roll-call reset and intake investigation

### Unresolved reset and intake contract

A reset or reap must not delete a committed sighting, its immutable client identity, or the trip and booking context needed to review it. It must also not acknowledge an intake that it can subsequently orphan. A physical tap must have a durable, tenant-scoped and authenticated destination that does not depend on a long schedule or reset transaction releasing its locks. A timeout, refusal, in-memory retry, or success response before durable handoff does not meet this requirement.

The current preflight, delete rollback and final reset checks protect particular committed orderings but do not serialize intake with reset commit. A PostgreSQL regression holds a reset before commit and shows the sighting insert can time out waiting for its author foreign-key lock, leaving no server observation. The current form does not establish a durable device queue for that attempt. An exclusive shop-wide intake fence has the same starvation problem and is not an accepted resolution.

Any locking design must define a consistent order for every intake, move, reset, erasure and settlement writer. It must not require durable intake to wait behind a long schedule transaction.

Until a reviewed non-starving protocol and its mixed-server cutover are proven, destructive reset/reap and sighting intake cannot be treated as safe concurrently. Either retain the original evidence through a separately durable handoff independent of reset-held locks, or establish a coordinated exclusion that preserves every refused or uncertain tap before it can be lost. Neither option is implemented by this proposal. Do not enable the offline capture, settlement or delivery prototype on the basis of these checks.

Acceptance requires real PostgreSQL tests with reset held before intake and with intake committed before the check, between check and delete, after delete, and around the final check and commit. Tests must verify the original client key, meeting, booking and trip context; retries after response loss; authorization revocation and erasure; and both reset and reap paths. Browser and mixed-version tests must show that a device keeps evidence until an authenticated receipt is durably applied. A passing single ordering does not establish the contract.

Move acceptance also needs both intake/move orderings, a move back to the original trip, late upload after a move or reset, and deleted or recreated identities. A separate durable intake is a possible design, not proof that moves, reset cutover or mixed-server lock ordering are safe.

One proposed slice is an append-only intake ledger with tenant and event identity, a keyed and versioned payload digest, and the original generation, meeting and subject context. Missing verification keys leave an event unresolved. Append-only intent does not prohibit required erasure scrubbing or terminal tombstones, and must not be used to justify destroying the only unsent copy. A receipt would mean only that the ledger transaction committed; seat allocation remains a separate decision. Review would read that retained context directly, including after the current booking or trip has moved or been removed. Reset would preserve the old generation and atomically switch the active one, rather than delete its context.

This is not yet an implementation or an approved migration. The current reset hard-deletes parent records, existing sighting readers depend on current booking rows, and removing parent foreign keys would also remove database-enforced tenant and parent integrity. Before an automatically applied schema change or activation, the proposal needs a reviewed authorization and revocation frontier, erasure and export rules, protected sensitive payloads, old-server behavior, and a cutover in which every reset, reap, move, intake and review writer preserves the generation contract. A durable ledger alone does not prove a safe occupancy projection or make device-only evidence visible to a concurrent move.


## Detailed authorization and evidence lifecycle

Authenticate staff; validate tenant ownership and the subject’s trip relationship, including removed subjects. Apply the offline note gate even to deferred dependencies. Persist and replay note-disposal receipts; the device applies them before snapshot merging even if refresh fails. Notes may contain health information and follow roll-call authorization, erasure, export and retention rules. Minimized safety facts retained after erasure may remain linkable through trip, event and receipt identifiers; do not describe them as anonymous or claim selective erasure without proof.

Register ledger and decisions for subject, author and reviewer export, merge and erasure. Apply the existing unbounded safety-evidence retention classification for roll-call history and its erasure sweep, including note scrubbing. Before a proven durable handoff, preserve unsent evidence, including unreadable ciphertext; a loss notice is not a handoff or permission to delete it. Authentication and tenant scope still govern any recovery. Do not assume an old key is recoverable merely because ciphertext remains.

