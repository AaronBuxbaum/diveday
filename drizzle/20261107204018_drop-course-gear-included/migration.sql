-- diveday:allow-destructive drop-column courses.gear_included: replaced by included_rental_kinds (#2796); nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-column waiver_records.doctor_unlock_failures: retired 2026-11-06, no wrong-date lockout; nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-column waiver_records.medical_answer_seal: retired 2026-11-06; nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
ALTER TABLE "courses" DROP COLUMN "gear_included";--> statement-breakpoint
ALTER TABLE "waiver_records" DROP COLUMN "doctor_unlock_failures";--> statement-breakpoint
ALTER TABLE "waiver_records" DROP COLUMN "medical_answer_seal";