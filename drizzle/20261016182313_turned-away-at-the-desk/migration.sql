CREATE TYPE "turn_away_reason" AS ENUM('medical', 'waiver', 'card', 'age', 'identity', 'payment');--> statement-breakpoint
ALTER TYPE "trip_desk_event_kind" ADD VALUE 'seat_turned_away';--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "turned_away_reason" "turn_away_reason";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "turned_away_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_turned_away_is_released" CHECK ("turned_away_at" is null or "status" in ('no_show', 'cancelled'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_turned_away_reason_has_time" CHECK ("turned_away_reason" is null or "turned_away_at" is not null);