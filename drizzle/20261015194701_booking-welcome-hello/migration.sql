CREATE TYPE "welcome_hello" AS ENUM('first_ocean_dive', 'celebrating', 'nervous');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "welcome_hello" "welcome_hello";