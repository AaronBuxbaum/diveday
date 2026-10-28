ALTER TABLE "notification_send_queue" ADD COLUMN "recipient_person_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_send_queue" ADD COLUMN "recipient_trip_id" uuid;