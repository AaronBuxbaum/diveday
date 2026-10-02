-- The schema half of ADR 20261001-logbook decision 7: the cut features' code is
-- already deleted, and this drops the tables, columns and enum values it left
-- behind. Nothing in the release this ships beside reads any of them.
--
-- The two DELETEs are the one hand-added part. `gift_pass` and the booking
-- capability purpose `arrival` are enum values being removed by a type rebuild,
-- and a row still carrying either would fail the cast back into the new type
-- and stop the build. Nothing has written either since the cut; the DELETEs
-- make the rebuild certain rather than leaving it to the state of the database.
--
-- diveday:allow-destructive drop-table season_events: cut by ADR 20261001-logbook decision 7; its reader and writer are already deleted, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-table display_tokens: cut by ADR 20261001-logbook decision 7; its reader and writer are already deleted, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-table shop_print_runs: cut by ADR 20261001-logbook decision 7; its reader and writer are already deleted, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-table person_shelf_tokens: cut by ADR 20261001-logbook decision 7; its reader and writer are already deleted, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-table booking_gifts: cut by ADR 20261001-logbook decision 7; its reader and writer are already deleted, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-column shops.conservation_commitments: cut by ADR 20261001-logbook decision 7; nothing in the live release selects or writes it, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-column shops.send_window_start_hour: cut by ADR 20261001-logbook decision 7; nothing in the live release selects or writes it, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-column shops.send_window_end_hour: cut by ADR 20261001-logbook decision 7; nothing in the live release selects or writes it, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-column shops.fly_safe_hours_single: cut by ADR 20261001-logbook decision 7; nothing in the live release selects or writes it, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-column shops.fly_safe_hours_repetitive: cut by ADR 20261001-logbook decision 7; nothing in the live release selects or writes it, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-column shops.tide_window_public: cut by ADR 20261001-logbook decision 7; nothing in the live release selects or writes it, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-column shops.public_boat_line: cut by ADR 20261001-logbook decision 7; nothing in the live release selects or writes it, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-column shops.region_slug: cut by ADR 20261001-logbook decision 7; nothing in the live release selects or writes it, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-column shops.welcome_note: cut by ADR 20261001-logbook decision 7; nothing in the live release selects or writes it, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-column shops.dock_call_note: cut by ADR 20261001-logbook decision 7; nothing in the live release selects or writes it, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-column shops.sign_off_note: cut by ADR 20261001-logbook decision 7; nothing in the live release selects or writes it, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-column shops.show_year_on_diveday: cut by ADR 20261001-logbook decision 7; nothing in the live release selects or writes it, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-column booking_arrival_events.display_token_id: the lobby kiosk that wrote it is cut (ADR 20261001-logbook decision 7) and no reader remains, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-constraint booking_arrival_events_display_token_id_display_tokens_id_fkey: the foreign key of the column dropped below, into a table this migration drops, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-constraint shops_fly_safe_hours_in_range: the check over the two fly-safe columns this migration drops, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-constraint shops_hospitality_notes_bounded: the check over the three note columns this migration drops, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-type display_token_purpose: its only column goes with a table this migration drops, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-type print_sheet: its only column goes with a table this migration drops, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-type booking_capability_purpose: recreated one statement later without `arrival`, which nothing mints (CapabilityPurpose in src/db/booking-capabilities.ts never named it), pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-type notification_kind: recreated one statement later without `gift_pass`, which nothing sends since gifting a dive was cut, pre-pilot, no users (H-49)
-- diveday:allow-destructive alter-column-type booking_capabilities.purpose: covers both steps; enum to text cannot lose a value, and the cast back lands every row on the value it had once the arrival rows are deleted above
-- diveday:allow-destructive alter-column-type notification_deliveries.kind: covers both steps; enum to text cannot lose a value, and the cast back lands every row on the value it had once the gift_pass rows are deleted above
-- diveday:allow-destructive alter-column-type notification_delivery_attempts.kind: covers both steps; enum to text cannot lose a value, and the cast back lands every row on the value it had once the gift_pass rows are deleted above

DELETE FROM "notification_delivery_attempts" WHERE "kind" = 'gift_pass';--> statement-breakpoint
DELETE FROM "notification_deliveries" WHERE "kind" = 'gift_pass';--> statement-breakpoint
DELETE FROM "booking_capabilities" WHERE "purpose" = 'arrival';--> statement-breakpoint
ALTER TABLE "booking_arrival_events" DROP CONSTRAINT "booking_arrival_events_display_token_id_display_tokens_id_fkey";--> statement-breakpoint
DROP TABLE "booking_gifts";--> statement-breakpoint
DROP TABLE "display_tokens";--> statement-breakpoint
DROP TABLE "person_shelf_tokens";--> statement-breakpoint
DROP TABLE "season_events";--> statement-breakpoint
DROP TABLE "shop_print_runs";--> statement-breakpoint
ALTER TABLE "shops" DROP CONSTRAINT "shops_fly_safe_hours_in_range";--> statement-breakpoint
ALTER TABLE "shops" DROP CONSTRAINT "shops_hospitality_notes_bounded";--> statement-breakpoint
DROP INDEX "shops_region_slug_idx";--> statement-breakpoint
ALTER TABLE "booking_capabilities" ALTER COLUMN "purpose" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "booking_capability_purpose";--> statement-breakpoint
CREATE TYPE "booking_capability_purpose" AS ENUM('readiness', 'confirm', 'claim', 'handoff');--> statement-breakpoint
ALTER TABLE "booking_capabilities" ALTER COLUMN "purpose" SET DATA TYPE "booking_capability_purpose" USING "purpose"::"booking_capability_purpose";--> statement-breakpoint
ALTER TABLE "notification_deliveries" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "notification_kind";--> statement-breakpoint
CREATE TYPE "notification_kind" AS ENUM('booking_confirmation', 'waiver_request', 'booking_handoff', 'readiness_link', 'trip_reminder_7d', 'trip_reminder_24h', 'trip_recap', 'trip_blowout', 'trip_minimum_not_met');--> statement-breakpoint
ALTER TABLE "notification_deliveries" ALTER COLUMN "kind" SET DATA TYPE "notification_kind" USING "kind"::"notification_kind";--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ALTER COLUMN "kind" SET DATA TYPE "notification_kind" USING "kind"::"notification_kind";--> statement-breakpoint
ALTER TABLE "booking_arrival_events" DROP COLUMN "display_token_id";--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "conservation_commitments";--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "send_window_start_hour";--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "send_window_end_hour";--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "fly_safe_hours_single";--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "fly_safe_hours_repetitive";--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "tide_window_public";--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "public_boat_line";--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "region_slug";--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "welcome_note";--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "dock_call_note";--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "sign_off_note";--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "show_year_on_diveday";--> statement-breakpoint
DROP TYPE "display_token_purpose";--> statement-breakpoint
DROP TYPE "print_sheet";