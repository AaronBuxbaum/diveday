-- diveday:allow-destructive drop-table held_sends: held sends now live on notification_send_queue (issue #2730); every row still held is copied there first, and the previous release only fails a hold tapped during the deploy itself; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-type held_send_kind: only held_sends.kind used it, dropped above in this migration (issue #2730)
ALTER TABLE "notification_send_queue" ADD COLUMN "intent" jsonb;--> statement-breakpoint
ALTER TABLE "notification_send_queue" ADD COLUMN "actor_person_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_send_queue" ADD CONSTRAINT "notification_send_queue_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "notification_send_queue" ADD CONSTRAINT "notification_send_queue_one_payload" CHECK ("intent" is null or "payload_sealed" is null);--> statement-breakpoint
INSERT INTO "notification_send_queue" ("id", "shop_id", "idempotency_key", "intent", "actor_person_id", "status", "next_attempt_at") SELECT "id", "shop_id", 'held-send/' || "id", "payload", "actor_person_id", 'queued', "run_at" FROM "held_sends";--> statement-breakpoint
DROP TABLE "held_sends";--> statement-breakpoint
DROP TYPE "held_send_kind";