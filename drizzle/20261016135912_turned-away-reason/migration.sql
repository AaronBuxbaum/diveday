CREATE TYPE "turn_away_reason" AS ENUM('medical', 'waiver', 'card', 'age', 'identity', 'payment');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "turned_away_reason" "turn_away_reason";--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_turned_away_is_released" CHECK ("turned_away_reason" is null or "status" in ('no_show', 'cancelled'));