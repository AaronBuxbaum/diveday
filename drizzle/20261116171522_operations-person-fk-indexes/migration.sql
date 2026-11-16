CREATE INDEX "bookings_course_followup_person_idx" ON "bookings" ("course_followup_by_person_id","shop_id");--> statement-breakpoint
CREATE INDEX "recovery_activities_coordinator_idx" ON "recovery_activities" ("coordinator_person_id","shop_id");--> statement-breakpoint
CREATE INDEX "recovery_activities_created_by_idx" ON "recovery_activities" ("created_by_person_id","shop_id");--> statement-breakpoint
CREATE INDEX "recovery_activities_arrangements_by_idx" ON "recovery_activities" ("arrangements_confirmed_by_person_id","shop_id");--> statement-breakpoint
CREATE INDEX "recovery_activity_events_actor_idx" ON "recovery_activity_events" ("actor_person_id","shop_id");--> statement-breakpoint
CREATE INDEX "recovery_activity_offers_actor_idx" ON "recovery_activity_offers" ("actor_person_id","shop_id");--> statement-breakpoint
CREATE INDEX "recovery_activity_participants_person_idx" ON "recovery_activity_participants" ("person_id","shop_id");--> statement-breakpoint
CREATE INDEX "recovery_activity_participants_confirmed_by_idx" ON "recovery_activity_participants" ("confirmed_by_person_id","shop_id");--> statement-breakpoint
CREATE INDEX "trip_credit_entries_person_idx" ON "trip_credit_entries" ("person_id","shop_id");--> statement-breakpoint
CREATE INDEX "trip_credit_entries_actor_idx" ON "trip_credit_entries" ("actor_person_id","shop_id");