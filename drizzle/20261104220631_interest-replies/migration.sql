CREATE TYPE "interest_reply_channel" AS ENUM('email', 'sms', 'whatsapp');--> statement-breakpoint
ALTER TYPE "interest_closed_as" ADD VALUE 'replied';--> statement-breakpoint
CREATE TABLE "interest_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"interest_id" uuid NOT NULL,
	"channel" "interest_reply_channel" NOT NULL,
	"to_address" text,
	"body" text,
	"locale" text NOT NULL,
	"sent_by_person_id" uuid NOT NULL,
	"status" "notification_delivery_status" NOT NULL,
	"provider_message_id" text,
	"send_error_code" text,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_replies_body_bounded" CHECK ("body" is null or (length(btrim("body")) > 0 and length("body") <= 1000))
);
--> statement-breakpoint
CREATE INDEX "interest_replies_shop_interest_idx" ON "interest_replies" ("shop_id","interest_id","sent_at");--> statement-breakpoint
CREATE INDEX "interest_replies_sent_by_person_idx" ON "interest_replies" ("sent_by_person_id");--> statement-breakpoint
ALTER TABLE "interest_replies" ADD CONSTRAINT "interest_replies_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "interest_replies" ADD CONSTRAINT "interest_replies_sent_by_person_id_people_id_fkey" FOREIGN KEY ("sent_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "interest_replies" ADD CONSTRAINT "interest_replies_shop_interest_fk" FOREIGN KEY ("shop_id","interest_id") REFERENCES "interests"("shop_id","id") ON DELETE CASCADE;