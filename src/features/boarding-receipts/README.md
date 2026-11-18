# Boarding receipt reconciliation

This inactive module contains a read-only, tenant-scoped comparison of stored
observation keys against caller-supplied proposed receipts. It is not routed to
staff or workers, writes nothing, and does not authorize a cutover. Its result
always reports the writer drain as unverified and historical joined-key coverage
as unknown. A match covers only selected stored identifiers; it does not verify
receipt persistence, meeting or generation identity, or current authorization.

The inventory fails closed above 10,000 rows. Larger inventories need a bounded,
consistent pagination design before this module can be used for reconciliation.
Callers must authorize the shop and arrange a real writer drain; a single read
cannot establish either. Older servers can acknowledge joined keys without
persisting them, so those keys cannot be reconstructed from this inventory.

The PostgreSQL test models a temporary table barrier on a disposable database.
That global lock would block safety traffic and is not an activation procedure.
The separate `src/test/boarding-receipt-prototype/claim.ts` prototype uses a
table installed only inside disposable PostgreSQL and PGlite test databases. It
exercises atomic draft-table claims and rollback but does not authenticate a caller,
verify a meeting, exclude old writers or create a device receipt. Production
sources must not import it; the architecture check rejects direct imports.

## Cutover requirements — not implemented

1. Preserve pending device evidence and establish a recovery path before
   stopping any writer. Do not discard a key merely because its payload or
   encryption key cannot currently be read.
2. Stop routing relevant requests and jobs to every old writer, including old
   server versions, workers, and reset/reap/snapshot paths. Drain their
   in-flight work and prevent them from rejoining. Offline shells cannot be
   assumed absent: prevent stale shells or credentials from reaching an old
   writer on reconnect, retain their unsent evidence, and provide an authorized
   recovery path. This needs independently verifiable fleet control; this
   module has no such control.
3. Under a separately reviewed cutover fence that does not lose urgent safety
   events, compare a consistent tenant-scoped snapshot against the actual
   receipt store. Resolve every missing or conflicting stored original key and
   revalidate at the cutover boundary. The current function accepts proposed
   objects, not the receipt store, and cannot establish that boundary.
4. Record historical joined-key coverage as unknown. A previously acknowledged
   key that old code never stored cannot be reconstructed from server rows.
   Preserve and recover device evidence where available.
5. Enable a new writer only after its atomic claims, original meeting identity,
   revocation/erasure ordering, reset preservation and device handoff have been
   verified together, with tenant scope and actual-aboard status assessed
   independently of a receipt. A clean inventory by itself is insufficient.
   Any failed check leaves the new receipt capture, settlement and delivery
   disabled; rollback must retain old observations, new receipts and original
   context. Do not resume an old writer that acknowledges unreserved keys
   without an independently verified compatible fallback.
