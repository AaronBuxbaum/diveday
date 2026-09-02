-- `notification_send_queue.payload` held the whole queued notification as
-- plaintext jsonb, and for half the notification kinds that includes a
-- capability URL carrying a **raw** bearer token — a verification,
-- password-reset, staff-invite, contact-confirmation, waiver, readiness, recap
-- or unsubscribe link (issue #1297). It is replaced by `payload_sealed`: the
-- same value under AES-256-GCM (src/lib/secret-box.ts).
--
-- `recipient_email` and `booking_id` come out of the blob at the same time,
-- because legal erasure matched on `payload ->> 'to'` and
-- `payload ->> 'bookingId'` and nothing can read through a seal. As columns
-- those two sweeps are stronger than the probes they replace, not weaker.
--
-- Nothing is carried across. Sealing the existing rows would need the key
-- inside a migration, and a plaintext token that has already been at rest is
-- not made safe by being sealed afterwards. A queued row left with no payload
-- is parked as `missing_payload` on the next daily drain — a surfaced failure,
-- not a silent one.
ALTER TABLE "notification_send_queue" ADD COLUMN "payload_sealed" text;--> statement-breakpoint
ALTER TABLE "notification_send_queue" ADD COLUMN "recipient_email" text;--> statement-breakpoint
ALTER TABLE "notification_send_queue" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
-- diveday:allow-destructive drop-column notification_send_queue.payload: pre-pilot, no users, H-49 — the only rows are undelivered retries in a demo database. The previous release reads this column solely from drainNotificationRetries and anonymizeShopPerson, neither of which is on a path a diver or a staffer requests: the drain runs from the daily /api/cron/reminders tick, and an erasure is a deliberate act nobody performs mid-deploy. A tick landing in the build-length window fails one cron pass, and the next one drains normally.
ALTER TABLE "notification_send_queue" DROP COLUMN "payload";
