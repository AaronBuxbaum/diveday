-- diveday:allow-destructive drop-column waiver_records.draft_signer_name: retired by waiver_drafts (#4130); nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-column waiver_records.draft_acknowledged: retired by waiver_drafts (#4130); nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-column waiver_records.draft_medical_answers: retired by waiver_drafts (#4130); nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-column waiver_records.draft_guardian: retired by waiver_drafts (#4130); nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-column waiver_records.draft_shop_answers: retired by waiver_drafts (#4130); nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-column waiver_records.draft_medical_alert: retired by waiver_drafts (#4130); nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-column waiver_records.draft_via_link_id: retired by waiver_drafts (#4130); nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
ALTER TABLE "waiver_records" DROP COLUMN "draft_signer_name";--> statement-breakpoint
ALTER TABLE "waiver_records" DROP COLUMN "draft_acknowledged";--> statement-breakpoint
ALTER TABLE "waiver_records" DROP COLUMN "draft_medical_answers";--> statement-breakpoint
ALTER TABLE "waiver_records" DROP COLUMN "draft_guardian";--> statement-breakpoint
ALTER TABLE "waiver_records" DROP COLUMN "draft_shop_answers";--> statement-breakpoint
ALTER TABLE "waiver_records" DROP COLUMN "draft_medical_alert";--> statement-breakpoint
ALTER TABLE "waiver_records" DROP COLUMN "draft_via_link_id";