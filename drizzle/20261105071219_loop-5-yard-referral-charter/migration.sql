ALTER TABLE "bookings" ADD COLUMN "referred_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "referred_in_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "referral_form_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "referral_form_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "referral_record_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "referral_record_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "private_charters_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "closed_from" date;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "closed_until" date;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "closure_reason" text;--> statement-breakpoint
ALTER TABLE "interests" ADD COLUMN "charter" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "interests" ADD COLUMN "charter_quote_cents" integer;--> statement-breakpoint
ALTER TABLE "interests" ADD COLUMN "charter_quote_currency" text;--> statement-breakpoint
ALTER TABLE "interests" ADD COLUMN "charter_quoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "interests" ADD COLUMN "charter_quoted_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "boats" ADD COLUMN "out_of_service_from" date;--> statement-breakpoint
ALTER TABLE "boats" ADD COLUMN "out_of_service_until" date;--> statement-breakpoint
ALTER TABLE "boats" ADD COLUMN "out_of_service_reason" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_referred_in_by_person_id_people_id_fkey" FOREIGN KEY ("referred_in_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_referral_form_by_person_id_people_id_fkey" FOREIGN KEY ("referral_form_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_referral_record_by_person_id_people_id_fkey" FOREIGN KEY ("referral_record_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_charter_quoted_by_person_id_people_id_fkey" FOREIGN KEY ("charter_quoted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_referral_attributed" CHECK (("referred_in_at" is null) = ("referred_in_by_person_id" is null)
        and ("referral_form_at" is null) = ("referral_form_by_person_id" is null)
        and ("referral_record_at" is null) = ("referral_record_by_person_id" is null)
        and ("referred_in_at" is not null or ("referral_form_at" is null and "referral_record_at" is null)));--> statement-breakpoint
ALTER TABLE "dive_sites" ADD CONSTRAINT "dive_sites_closure_window" CHECK (("closed_from" is null) = ("closed_until" is null)
        and ("closed_from" is null or "closed_from" <= "closed_until"));--> statement-breakpoint
ALTER TABLE "dive_sites" ADD CONSTRAINT "dive_sites_closure_reason" CHECK ("closure_reason" is null
        or ("closed_from" is not null and char_length("closure_reason") between 1 and 120));--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_charter_is_a_date" CHECK (not "charter" or "scope" = 'date');--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_charter_quote" CHECK (("charter_quote_cents" is null) = ("charter_quoted_at" is null)
        and ("charter_quoted_at" is null) = ("charter_quoted_by_person_id" is null)
        and ("charter_quote_cents" is null) = ("charter_quote_currency" is null)
        and ("charter_quote_cents" is null or ("charter" and "charter_quote_cents" > 0)));--> statement-breakpoint
ALTER TABLE "boats" ADD CONSTRAINT "boats_out_of_service_window" CHECK (("out_of_service_from" is null) = ("out_of_service_until" is null)
        and ("out_of_service_from" is null or "out_of_service_from" <= "out_of_service_until"));--> statement-breakpoint
ALTER TABLE "boats" ADD CONSTRAINT "boats_out_of_service_reason" CHECK ("out_of_service_reason" is null
        or ("out_of_service_from" is not null and char_length("out_of_service_reason") between 1 and 120));