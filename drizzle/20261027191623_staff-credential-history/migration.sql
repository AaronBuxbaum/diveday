CREATE TABLE "staff_credential_history" (
	"seq" bigserial PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"event" text NOT NULL,
	"kind" "staff_credential_kind" NOT NULL,
	"issued_at" date,
	"renews_at" date,
	"active" boolean NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "staff_credential_history_shop_credential_idx" ON "staff_credential_history" ("shop_id","credential_id","seq");--> statement-breakpoint
ALTER TABLE "staff_credential_history" ADD CONSTRAINT "staff_credential_history_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "staff_credential_history" ADD CONSTRAINT "staff_credential_history_32OPkfKC4FnJ_fkey" FOREIGN KEY ("credential_id") REFERENCES "staff_credentials"("id") ON DELETE CASCADE;