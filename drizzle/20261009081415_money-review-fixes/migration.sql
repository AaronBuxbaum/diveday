CREATE TYPE "order_source" AS ENUM('staff', 'public');--> statement-breakpoint
ALTER TABLE "trip_last_minute_promos" ADD COLUMN "max_redemptions" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "source" "order_source" DEFAULT 'staff'::"order_source" NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD COLUMN "promo_code_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD COLUMN "trip_promo_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_wOv22MgfdNda_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "shop_promo_codes"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_Ykz0XvNLTW0j_fkey" FOREIGN KEY ("trip_promo_id") REFERENCES "trip_last_minute_promos"("id");--> statement-breakpoint
ALTER TABLE "payment_operation_intents" ADD CONSTRAINT "payment_operation_intents_single_promo" CHECK ("promo_code_id" is null or "trip_promo_id" is null);