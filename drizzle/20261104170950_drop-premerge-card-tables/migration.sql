-- Issue #3732: the three card tables the ledger replaced, one release after the copy. The previous release declares none of them (they were declared only in a retired schema file, and the ledger has served every card read and write since), and the migration before this one copied any late row into "cards".
-- diveday:allow-destructive drop-constraint nitrox_certifications.nitrox_certifications_trGZxoDM1PY8_fkey: the table is dropped by this migration and no release reads it
-- diveday:allow-destructive drop-constraint specialty_certifications.specialty_certifications_zCxeEzEswSem_fkey: the table is dropped by this migration and no release reads it
-- diveday:allow-destructive drop-table certifications: replaced by "cards" in the previous release; no code reads or writes it
-- diveday:allow-destructive drop-table nitrox_certifications: replaced by "cards" in the previous release; no code reads or writes it
-- diveday:allow-destructive drop-table specialty_certifications: replaced by "cards" in the previous release; no code reads or writes it
ALTER TABLE "nitrox_certifications" DROP CONSTRAINT "nitrox_certifications_trGZxoDM1PY8_fkey";--> statement-breakpoint
ALTER TABLE "specialty_certifications" DROP CONSTRAINT "specialty_certifications_zCxeEzEswSem_fkey";--> statement-breakpoint
DROP TABLE "certifications";--> statement-breakpoint
DROP TABLE "nitrox_certifications";--> statement-breakpoint
DROP TABLE "specialty_certifications";