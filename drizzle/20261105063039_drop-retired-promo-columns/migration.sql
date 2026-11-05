-- diveday:allow-destructive drop-column booking_checkouts.promo_code_id: retired by deals (#2720); nothing reads or writes it and no schema declares it since #3878; pre-pilot, no users (H-20260815-no-legacy) (issue #3866)
-- diveday:allow-destructive drop-column booking_checkouts.trip_promo_id: retired by deals (#2720); nothing reads or writes it and no schema declares it since #3878; pre-pilot, no users (H-20260815-no-legacy) (issue #3866)
-- diveday:allow-destructive drop-column payment_operation_intents.promo_code_id: retired by deals (#2720); nothing reads or writes it and no schema declares it since #3878; pre-pilot, no users (H-20260815-no-legacy) (issue #3866)
-- diveday:allow-destructive drop-column payment_operation_intents.trip_promo_id: retired by deals (#2720); nothing reads or writes it and no schema declares it since #3878; pre-pilot, no users (H-20260815-no-legacy) (issue #3866)
ALTER TABLE "booking_checkouts" DROP COLUMN "promo_code_id";--> statement-breakpoint
ALTER TABLE "booking_checkouts" DROP COLUMN "trip_promo_id";--> statement-breakpoint
ALTER TABLE "payment_operation_intents" DROP COLUMN "promo_code_id";--> statement-breakpoint
ALTER TABLE "payment_operation_intents" DROP COLUMN "trip_promo_id";