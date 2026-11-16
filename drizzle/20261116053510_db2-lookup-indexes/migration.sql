CREATE INDEX "booking_referrals_referrer_idx" ON "booking_referrals" ("referred_by_booking_id");--> statement-breakpoint
CREATE INDEX "media_deletion_attempts_unfinished_idx" ON "media_deletion_attempts" ("created_at") WHERE "status" <> 'succeeded';--> statement-breakpoint
CREATE INDEX "payment_operation_intents_booking_idx" ON "payment_operation_intents" ("booking_id") WHERE "booking_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_operation_intents_order_idx" ON "payment_operation_intents" ("order_id") WHERE "order_id" is not null;