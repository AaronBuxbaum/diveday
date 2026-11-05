-- diveday:allow-destructive drop-column booking_checkouts.promo_code_id: retired by the deals table (ADR 20261103-a-deal-is-one-row); main stopped declaring it in #3878 and nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-column booking_checkouts.trip_promo_id: retired by the deals table (ADR 20261103-a-deal-is-one-row); main stopped declaring it in #3878 and nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-column payment_operation_intents.promo_code_id: retired by the deals table (ADR 20261103-a-deal-is-one-row); main stopped declaring it in #3878 and nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-column payment_operation_intents.trip_promo_id: retired by the deals table (ADR 20261103-a-deal-is-one-row); main stopped declaring it in #3878 and nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
ALTER TABLE "booking_checkouts" DROP COLUMN "promo_code_id";--> statement-breakpoint
ALTER TABLE "booking_checkouts" DROP COLUMN "trip_promo_id";--> statement-breakpoint
ALTER TABLE "payment_operation_intents" DROP COLUMN "promo_code_id";--> statement-breakpoint
ALTER TABLE "payment_operation_intents" DROP COLUMN "trip_promo_id";