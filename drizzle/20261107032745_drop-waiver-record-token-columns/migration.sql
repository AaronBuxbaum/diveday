-- diveday:allow-destructive drop-column waiver_records.token_hash: a release's link lives on `capabilities` since #3983; the previous release stopped declaring the column and nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-column waiver_records.expires_at: a release's clock lives on the capability that opens it since #3983; the previous release stopped declaring the column and nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
ALTER TABLE "waiver_records" DROP COLUMN "token_hash";--> statement-breakpoint
ALTER TABLE "waiver_records" DROP COLUMN "expires_at";
