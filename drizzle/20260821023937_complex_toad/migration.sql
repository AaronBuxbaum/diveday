-- diveday:allow-destructive drop-constraint shops.shops_shore_group_size_in_range: the check belongs to a column this same migration drops, so nothing is left for it to guard and nothing re-adds it. Pre-pilot, no users, H-49.
ALTER TABLE "shops" DROP CONSTRAINT "shops_shore_group_size_in_range";--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "divers_per_divemaster" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
-- diveday:allow-destructive drop-column shops.shore_group_size: replaced by divers_per_divemaster, a shop-wide advisory target that applies to every dive (ADR 20260820-shop-divemaster-ratio). Pre-pilot, no users, H-49 — and the previous release selects this column only through the whole-row shop read, where a dropped column is a missing key the Requests planner already treats as "not stated" and falls back to its 12-seat default for. Nothing writes it but the settings action, whose form no longer carries the field.
ALTER TABLE "shops" DROP COLUMN "shore_group_size";--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_divers_per_divemaster_in_range" CHECK ("divers_per_divemaster" >= 1 and "divers_per_divemaster" <= 20);
