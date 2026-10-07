# H-47: Is the production database disposable?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

Is the production database disposable? Raised 2026-08-14 by the self-declared-cards migration, which drops `NOT NULL` from `certifications.identifier`: forward-safe, but once new code has written a null there, an Instant Rollback hands the *previous* release a `null` in a column its types call a `string`, and the CSV importer throws on it. The generic question is what the recovery plan is for a deploy that has already written data the old code cannot read — a costly reconciliation, or a reset.

## Minimum outcome to record

A stated fact about the current stage, with the condition that ends it, so agents stop designing reconciliation paths for data that nobody would miss.

## Unblocks / follow-up

**Decided 2026-08-14 (Aaron Buxbaum): the database is disposable — there are no active users, so wiping and re-seeding is a safe recovery.** A bad deploy that corrupts or strands data is a nuisance to be reset, not an incident to be reconciled by hand. This is a **fact with an expiry, not a licence**: it says what recovery is available today, and it does **not** relax the expand/contract rule, the destructive-migration guard, or the requirement that a migration be forward-safe — those exist to keep the *previous release* alive mid-deploy, which is a separate problem that a reset does not solve and that a real shop watching its schedule would still feel. It also does not touch H-02's retention windows or the erasure path. It expires the moment the first pilot shop has real divers in the system; whoever onboards that shop owns retiring this row and the escape hatch it authorises. Consumed by [deploy-and-migrations-runbook.md](../../engineering/deploy-and-migrations-runbook.md) §"Safe to land, unsafe to roll back into", which is the plan once this expires. Closes the rollback half of `FU-20260814-self-declared-rollback-and-sighting-authority`.

Part of the [human decision log](README.md#decision-register).
