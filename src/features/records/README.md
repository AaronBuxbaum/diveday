# records

What the shop keeps, hands over and forgets: export and import, backups, retention, and
erasure.

## Owns

- Leaving and arriving: `backup-export/`, `shop-backup-delivery-claims.ts`, `import/`,
  `imported-payment-history.ts`.
- Forgetting: `anonymize.ts`, `anonymization.ts`, `guardian-erasure.ts`, `processor-erasure.ts`,
  `retention/`.

## Does not own

The tables and their coverage lists (`src/db/schema/`, `src/db/export/index.ts`), and the person record
itself (`people`).

## Invariants

- Every table and every exported column is exported, folded or excluded (the coverage test);
  access is re-checked against the database on each request.
- An imported card lands verified and flagged, and a number another diver holds is reported,
  never reassigned; an imported waiver never overrides a live medical hold; imported prior visits
  write inert, deduplicated history and never an operational table.
- Every append-only table is in exactly one of `RETENTION_DAYS`, `UNBOUNDED_BY_DECISION` or
  `OUTSIDE_RETENTION`; retention prunes trails, never people; the windows are a human decision
  (HD-11); one pass is bounded.
- Erasure is safety- and security-sensitive: a `dive-domain-expert` and a `security-reviewer` run.
