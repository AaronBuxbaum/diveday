CREATE TABLE "roll_call_event_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"client_event_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"state" text NOT NULL,
	"subject_kind" "roll_call_subject_kind",
	"booking_id" uuid,
	"crew_person_id" uuid,
	"intent_fingerprint" text,
	"proof_fingerprint" text,
	"key_fingerprint" text,
	"unresolved_reason" text,
	"note_disposition" text,
	"accepted_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roll_call_event_claims_shape" CHECK ((
      "state" = 'erased' and "subject_kind" is null and "booking_id" is null and "crew_person_id" is null
      and "intent_fingerprint" is null and "proof_fingerprint" is null and "key_fingerprint" is null and "unresolved_reason" is null
      and "note_disposition" is null and "accepted_event_id" is null
    ) or (
      "state" in ('accepted', 'unresolved') and "subject_kind" is not null and "intent_fingerprint" is not null and "proof_fingerprint" is not null and "key_fingerprint" is not null
      and (("subject_kind" = 'seat' and "booking_id" is not null and "crew_person_id" is null)
        or ("subject_kind" = 'crew' and "crew_person_id" is not null and "booking_id" is null))
      and (("state" = 'accepted' and "accepted_event_id" is not null and "unresolved_reason" is null)
        or ("state" = 'unresolved' and "accepted_event_id" is null and "unresolved_reason" is not null))
    )),
	CONSTRAINT "roll_call_event_claims_reason" CHECK ("unresolved_reason" is null or "unresolved_reason" in ('meeting_identity_unverified', 'unresolved_predecessor')),
	CONSTRAINT "roll_call_event_claims_note_disposition" CHECK ("note_disposition" is null or "note_disposition" in ('discarded_erasure_cutoff', 'discarded_unverified_snapshot'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "roll_call_event_claims_shop_client_unique" ON "roll_call_event_claims" ("shop_id","client_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roll_call_event_claims_accepted_event_unique" ON "roll_call_event_claims" ("accepted_event_id");--> statement-breakpoint
CREATE INDEX "roll_call_event_claims_booking_idx" ON "roll_call_event_claims" ("booking_id");--> statement-breakpoint
CREATE INDEX "roll_call_event_claims_crew_person_idx" ON "roll_call_event_claims" ("crew_person_id");--> statement-breakpoint
ALTER TABLE "roll_call_event_claims" ADD CONSTRAINT "roll_call_event_claims_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "roll_call_event_claims" ADD CONSTRAINT "roll_call_event_claims_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "roll_call_event_claims" ADD CONSTRAINT "roll_call_event_claims_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "roll_call_event_claims" ADD CONSTRAINT "roll_call_event_claims_crew_person_id_people_id_fkey" FOREIGN KEY ("crew_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "roll_call_event_claims" ADD CONSTRAINT "roll_call_event_claims_7PQwLZQNpyZp_fkey" FOREIGN KEY ("accepted_event_id") REFERENCES "roll_call_events"("id");