-- diveday:allow-destructive rename-table buddy_pair_members: pre-pilot, no users (H-20260815-no-legacy); the previous release reads this table during the build window only, and a failed buddy-team read there is a nuisance, not lost data (issue #2735)
ALTER TABLE "buddy_pair_members" RENAME TO "buddy_team_members";--> statement-breakpoint
ALTER TABLE "buddy_team_members" RENAME CONSTRAINT "buddy_pair_members_one_subject" TO "buddy_team_members_one_subject";--> statement-breakpoint
ALTER INDEX "buddy_pair_members_booking_unique" RENAME TO "buddy_team_members_booking_unique";--> statement-breakpoint
ALTER INDEX "buddy_pair_members_shop_trip_idx" RENAME TO "buddy_team_members_shop_trip_idx";--> statement-breakpoint
ALTER INDEX "buddy_pair_members_pair_idx" RENAME TO "buddy_team_members_pair_idx";