CREATE TYPE "security_step_up_purpose" AS ENUM('money', 'export', 'backup');--> statement-breakpoint
CREATE TYPE "staff_credential_kind" AS ENUM('instructor_rating', 'divemaster_rating', 'liability_insurance', 'first_aid_cpr', 'oxygen_provider', 'captains_licence', 'other');--> statement-breakpoint
ALTER TYPE "order_line_item_kind" ADD VALUE 'pass_through_fee' BEFORE 'merchandise';--> statement-breakpoint
CREATE TABLE "account_security" (
	"user_account_id" uuid PRIMARY KEY,
	"totp_secret_sealed" text,
	"totp_enabled_at" timestamp with time zone,
	"recovery_code_hashes" jsonb DEFAULT '[]' NOT NULL,
	"last_totp_step" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_step_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_account_id" uuid NOT NULL,
	"account_session_id" uuid NOT NULL,
	"purpose" "security_step_up_purpose" NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_step_ups_expiry_after_verification" CHECK ("expires_at" > "verified_at")
);
--> statement-breakpoint
CREATE TABLE "executed_dives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"dive_number" integer NOT NULL,
	"actual_site_id" uuid,
	"entered_at" timestamp with time zone,
	"exited_at" timestamp with time zone,
	"max_depth_meters" double precision,
	"observed_conditions" jsonb DEFAULT 'null',
	"not_recorded" jsonb DEFAULT '[]' NOT NULL,
	"recorded_by_person_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executed_dives_number_positive" CHECK ("dive_number" >= 1),
	CONSTRAINT "executed_dives_depth_nonnegative" CHECK ("max_depth_meters" is null or "max_depth_meters" >= 0),
	CONSTRAINT "executed_dives_exit_after_entry" CHECK ("entered_at" is null or "exited_at" is null or "exited_at" > "entered_at")
);
--> statement-breakpoint
CREATE TABLE "staff_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "staff_credential_kind" NOT NULL,
	"name" text NOT NULL,
	"issuing_body" text,
	"identifier" text,
	"issued_at" date,
	"renews_at" date,
	"status" "certification_status" DEFAULT 'pending'::"certification_status" NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_person_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_credentials_renewal_after_issue" CHECK ("issued_at" is null or "renews_at" is null or "renews_at" >= "issued_at")
);
--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD COLUMN "pass_through_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD COLUMN "pass_through_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pass_through_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "pass_through_fee" jsonb DEFAULT 'null';--> statement-breakpoint
CREATE INDEX "account_step_ups_session_purpose_idx" ON "account_step_ups" ("account_session_id","purpose","expires_at");--> statement-breakpoint
CREATE INDEX "account_step_ups_account_expires_idx" ON "account_step_ups" ("user_account_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "executed_dives_trip_number_live_unique" ON "executed_dives" ("trip_id","dive_number") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "executed_dives_shop_trip_idx" ON "executed_dives" ("shop_id","trip_id","dive_number");--> statement-breakpoint
CREATE INDEX "staff_credentials_shop_person_idx" ON "staff_credentials" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "staff_credentials_renewal_idx" ON "staff_credentials" ("shop_id","renews_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_credentials_live_identity_unique" ON "staff_credentials" ("shop_id","person_id","kind",lower("identifier")) WHERE "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "account_security" ADD CONSTRAINT "account_security_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_step_ups" ADD CONSTRAINT "account_step_ups_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_step_ups" ADD CONSTRAINT "account_step_ups_account_session_id_account_sessions_id_fkey" FOREIGN KEY ("account_session_id") REFERENCES "account_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_actual_site_id_dive_sites_id_fkey" FOREIGN KEY ("actual_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_reviewed_by_person_id_people_id_fkey" FOREIGN KEY ("reviewed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD CONSTRAINT "booking_checkout_bookings_pass_through_nonnegative" CHECK ("pass_through_cents" >= 0);--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_pass_through_nonnegative" CHECK ("pass_through_cents" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pass_through_nonnegative" CHECK ("pass_through_cents" >= 0);
