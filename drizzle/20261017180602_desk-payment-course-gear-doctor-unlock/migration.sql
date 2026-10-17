CREATE TYPE "desk_payment" AS ENUM('card', 'cash', 'card_and_cash');--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "desk_payment" "desk_payment";--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "gear_included" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "doctor_unlock_failures" integer DEFAULT 0 NOT NULL;