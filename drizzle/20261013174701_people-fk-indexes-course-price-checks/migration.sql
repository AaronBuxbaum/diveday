CREATE INDEX "activity_events_subject_person_id_idx" ON "activity_events" ("subject_person_id");--> statement-breakpoint
CREATE INDEX "activity_events_actor_person_id_idx" ON "activity_events" ("actor_person_id");--> statement-breakpoint
CREATE INDEX "trip_change_events_actor_person_id_idx" ON "trip_change_events" ("actor_person_id");--> statement-breakpoint
CREATE INDEX "trip_desk_events_subject_person_id_idx" ON "trip_desk_events" ("subject_person_id");--> statement-breakpoint
CREATE INDEX "trip_desk_events_actor_person_id_idx" ON "trip_desk_events" ("actor_person_id");--> statement-breakpoint
CREATE INDEX "bookings_person_id_idx" ON "bookings" ("person_id");--> statement-breakpoint
CREATE INDEX "certifications_person_id_idx" ON "certifications" ("person_id");--> statement-breakpoint
CREATE INDEX "roll_call_crew_events_person_id_idx" ON "roll_call_crew_events" ("person_id");--> statement-breakpoint
CREATE INDEX "roll_call_events_recorded_by_person_id_idx" ON "roll_call_events" ("recorded_by_person_id");--> statement-breakpoint
CREATE INDEX "inbound_messages_person_id_idx" ON "inbound_messages" ("person_id");--> statement-breakpoint
CREATE INDEX "staff_replies_person_id_idx" ON "staff_replies" ("person_id");--> statement-breakpoint
CREATE INDEX "orders_person_id_idx" ON "orders" ("person_id");--> statement-breakpoint
CREATE INDEX "executed_dives_recorded_by_person_id_idx" ON "executed_dives" ("recorded_by_person_id");--> statement-breakpoint
CREATE INDEX "waiver_records_person_id_idx" ON "waiver_records" ("person_id");--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_price_nonnegative" CHECK ("price_cents" is null or "price_cents" >= 0);--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_e_learning_price_nonnegative" CHECK ("e_learning_price_cents" is null or "e_learning_price_cents" >= 0);--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_private_price_nonnegative" CHECK ("private_price_cents" is null or "private_price_cents" >= 0);