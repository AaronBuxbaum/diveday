-- Issue #3778 (and #3782 item 2): the retired promo tables, enums, triggers and functions, dropped now rather than a release later (no users, H-20260815-no-legacy). The four retired columns stay one more release because the guard refuses a column drop while the previous release declares it (issue #3871). The triggers and functions go first, so the search_path gap in #3782 goes with them.
-- diveday:allow-destructive drop-constraint booking_checkouts.booking_checkouts_promo_code_id_shop_promo_codes_id_fkey: the table it points at or the column pair it guards is retired; pre-pilot, no users (H-20260815-no-legacy); replaced by deals (#2720)
-- diveday:allow-destructive drop-constraint booking_checkouts.booking_checkouts_trip_promo_id_trip_last_minute_promos_id_fkey: the table it points at or the column pair it guards is retired; pre-pilot, no users (H-20260815-no-legacy); replaced by deals (#2720)
-- diveday:allow-destructive drop-constraint payment_operation_intents.payment_operation_intents_wOv22MgfdNda_fkey: the table it points at or the column pair it guards is retired; pre-pilot, no users (H-20260815-no-legacy); replaced by deals (#2720)
-- diveday:allow-destructive drop-constraint payment_operation_intents.payment_operation_intents_Ykz0XvNLTW0j_fkey: the table it points at or the column pair it guards is retired; pre-pilot, no users (H-20260815-no-legacy); replaced by deals (#2720)
-- diveday:allow-destructive drop-constraint booking_checkouts.booking_checkouts_single_promo_source: the table it points at or the column pair it guards is retired; pre-pilot, no users (H-20260815-no-legacy); replaced by deals (#2720)
-- diveday:allow-destructive drop-constraint payment_operation_intents.payment_operation_intents_single_promo: the table it points at or the column pair it guards is retired; pre-pilot, no users (H-20260815-no-legacy); replaced by deals (#2720)
-- diveday:allow-destructive drop-table shop_promo_codes: pre-pilot, no users (H-20260815-no-legacy); replaced by deals (#2720)
-- diveday:allow-destructive drop-table trip_last_minute_promos: pre-pilot, no users (H-20260815-no-legacy); replaced by deals (#2720)
-- diveday:allow-destructive drop-type shop_promo_status: only the dropped table used it; pre-pilot, no users (H-20260815-no-legacy); replaced by deals (#2720)
-- diveday:allow-destructive drop-type trip_last_minute_promo_status: only the dropped table used it; pre-pilot, no users (H-20260815-no-legacy); replaced by deals (#2720)
DROP TRIGGER "forward_retired_shop_promo_codes" ON "shop_promo_codes";--> statement-breakpoint
DROP TRIGGER "forward_retired_trip_last_minute_promos" ON "trip_last_minute_promos";--> statement-breakpoint
DROP TRIGGER "fill_deal_id_from_retired_promo" ON "booking_checkouts";--> statement-breakpoint
DROP TRIGGER "fill_deal_id_from_retired_promo" ON "payment_operation_intents";--> statement-breakpoint
DROP FUNCTION "forward_retired_shop_promo_codes"();--> statement-breakpoint
DROP FUNCTION "forward_retired_trip_last_minute_promos"();--> statement-breakpoint
DROP FUNCTION "fill_deal_id_from_retired_promo"();--> statement-breakpoint
ALTER TABLE "booking_checkouts" DROP CONSTRAINT "booking_checkouts_promo_code_id_shop_promo_codes_id_fkey";--> statement-breakpoint
ALTER TABLE "booking_checkouts" DROP CONSTRAINT "booking_checkouts_trip_promo_id_trip_last_minute_promos_id_fkey";--> statement-breakpoint
ALTER TABLE "payment_operation_intents" DROP CONSTRAINT "payment_operation_intents_wOv22MgfdNda_fkey";--> statement-breakpoint
ALTER TABLE "payment_operation_intents" DROP CONSTRAINT "payment_operation_intents_Ykz0XvNLTW0j_fkey";--> statement-breakpoint
DROP TABLE "shop_promo_codes";--> statement-breakpoint
DROP TABLE "trip_last_minute_promos";--> statement-breakpoint
ALTER TABLE "booking_checkouts" DROP CONSTRAINT "booking_checkouts_single_promo_source";--> statement-breakpoint
ALTER TABLE "payment_operation_intents" DROP CONSTRAINT "payment_operation_intents_single_promo";--> statement-breakpoint
DROP TYPE "shop_promo_status";--> statement-breakpoint
DROP TYPE "trip_last_minute_promo_status";