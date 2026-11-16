CREATE TABLE "disruption_recovery_events" (
	"id" uuid PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"blowout_diver_id" uuid NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"replacement_booking_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial,
	CONSTRAINT "disruption_recovery_events_outcome" CHECK ("outcome" in ('pending', 'contacted', 'declined', 'rebooked')),
	CONSTRAINT "disruption_recovery_events_link" CHECK (("outcome" = 'rebooked') = ("replacement_booking_id" is not null))
);
--> statement-breakpoint
CREATE INDEX "disruption_recovery_events_diver_seq_idx" ON "disruption_recovery_events" ("shop_id","blowout_diver_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_blowout_divers_shop_id_id_unique" ON "trip_blowout_divers" ("shop_id","id");--> statement-breakpoint
ALTER TABLE "disruption_recovery_events" ADD CONSTRAINT "disruption_recovery_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "disruption_recovery_events" ADD CONSTRAINT "disruption_recovery_events_j3hHvgocSJqK_fkey" FOREIGN KEY ("blowout_diver_id") REFERENCES "trip_blowout_divers"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "disruption_recovery_events" ADD CONSTRAINT "disruption_recovery_events_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "disruption_recovery_events" ADD CONSTRAINT "disruption_recovery_events_ys8oacbMsKv1_fkey" FOREIGN KEY ("replacement_booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "disruption_recovery_events" ADD CONSTRAINT "disruption_recovery_events_scoped_diver_fk" FOREIGN KEY ("shop_id","blowout_diver_id") REFERENCES "trip_blowout_divers"("shop_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "disruption_recovery_events" ADD CONSTRAINT "disruption_recovery_events_scoped_replacement_fk" FOREIGN KEY ("shop_id","replacement_booking_id") REFERENCES "bookings"("shop_id","id");