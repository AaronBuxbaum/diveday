-- diveday:allow-destructive drop-table held_sends: held sends now live on notification_send_queue (issue #2730); a row lives eight seconds, so at most a hold tapped during the deploy is lost; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-type held_send_kind: only held_sends.kind used it, dropped above in this migration (issue #2730)
DROP TABLE "held_sends";--> statement-breakpoint
ALTER TABLE "notification_send_queue" ADD COLUMN "intent" jsonb;--> statement-breakpoint
ALTER TABLE "notification_send_queue" ADD COLUMN "actor_person_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_send_queue" ADD CONSTRAINT "notification_send_queue_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "notification_send_queue" ADD CONSTRAINT "notification_send_queue_one_payload" CHECK ("intent" is null or "payload_sealed" is null);--> statement-breakpoint
DROP TYPE "held_send_kind";