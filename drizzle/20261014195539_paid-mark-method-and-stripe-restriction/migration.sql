CREATE TYPE "manual_payment_method" AS ENUM('cash', 'card', 'other');--> statement-breakpoint
ALTER TABLE "booking_payment_events" ADD COLUMN "method" "manual_payment_method";--> statement-breakpoint
ALTER TABLE "booking_payment_events" ADD COLUMN "recorded_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_payments" ADD COLUMN "method" "manual_payment_method";--> statement-breakpoint
ALTER TABLE "booking_payments" ADD COLUMN "recorded_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "shop_stripe_accounts" ADD COLUMN "payments_restricted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_payment_events" ADD CONSTRAINT "booking_payment_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;