-- diveday:allow-destructive drop-table notification_delivery_attempts: retired by #2728, notification_deliveries now holds one row per send so the trail is its rows; pre-pilot, no users (H-20260815-no-legacy)
DROP TABLE "notification_delivery_attempts";--> statement-breakpoint
DROP INDEX "notification_deliveries_booking_kind_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_once_only_unique" ON "notification_deliveries" ("booking_id","kind") WHERE "kind" in ('booking_confirmation', 'trip_reminder_7d', 'trip_reminder_24h', 'trip_recap');--> statement-breakpoint
CREATE INDEX "notification_deliveries_booking_kind_attempted_idx" ON "notification_deliveries" ("booking_id","kind","attempted_at");