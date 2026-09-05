CREATE TYPE "dive_intent" AS ENUM('easing_back', 'small_life', 'a_wreck', 'skills', 'good_day');--> statement-breakpoint
CREATE TYPE "re_entry_ask" AS ENUM('deck_word', 'easy_first_dive', 'refresher_course');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "dive_intent" "dive_intent";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "re_entry_ask" "re_entry_ask";--> statement-breakpoint
-- diveday:allow-destructive drop-column bookings.group_preference: the free-text "What kind of dive
-- would make your day?" box this column stored is replaced in this same change by dive_intent, which
-- asks the identical question in five plain choices the crew can count; its only writer was the
-- public booking form, which stops writing it in this release, and its only reader was the roster
-- note now rendered from re_entry_ask. Pre-pilot, no users, H-49.
ALTER TABLE "bookings" DROP COLUMN "group_preference";
