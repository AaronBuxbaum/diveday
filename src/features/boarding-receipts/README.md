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
