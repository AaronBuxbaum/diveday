CREATE TYPE "tank_fill_o2_clean_gap" AS ENUM('lapsed', 'never');--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD COLUMN "fill_o2_clean_gap" "tank_fill_o2_clean_gap";--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_fill_o2_clean_gap" CHECK ("fill_o2_clean_gap" is null or ("fill_o2_percent" is not null and "fill_o2_percent" > 21));