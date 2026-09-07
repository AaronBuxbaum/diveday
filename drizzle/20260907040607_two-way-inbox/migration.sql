CREATE TYPE "inbound_channel" AS ENUM('email', 'sms', 'whatsapp');--> statement-breakpoint
CREATE TABLE "inbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid,
	"channel" "inbound_channel" NOT NULL,
	"from_address" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"media_count" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"provider_message_id" text NOT NULL,
	"in_reply_to_delivery_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"inbound_message_id" uuid,
	"channel" "inbound_channel" NOT NULL,
	"to_address" text NOT NULL,
	"body" text NOT NULL,
	"locale" text NOT NULL,
	"sent_by_person_id" uuid NOT NULL,
	"status" "notification_delivery_status" NOT NULL,
	"provider_message_id" text,
	"send_error_code" text,
	"send_error" text,
	"sent_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "inbound_email_token" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_messages_channel_provider_message_unique" ON "inbound_messages" ("channel","provider_message_id");--> statement-breakpoint
CREATE INDEX "inbound_messages_shop_received_idx" ON "inbound_messages" ("shop_id","received_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "inbound_messages_shop_unanswered_idx" ON "inbound_messages" ("shop_id") WHERE "deleted_at" is null and "answered_at" is null;--> statement-breakpoint
CREATE INDEX "inbound_messages_shop_person_received_idx" ON "inbound_messages" ("shop_id","person_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shops_inbound_email_token_unique" ON "shops" ("inbound_email_token");--> statement-breakpoint
CREATE INDEX "staff_replies_shop_person_sent_idx" ON "staff_replies" ("shop_id","person_id","sent_at");--> statement-breakpoint
CREATE INDEX "staff_replies_inbound_message_idx" ON "staff_replies" ("inbound_message_id");--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_xZJ0xNr6OkuL_fkey" FOREIGN KEY ("in_reply_to_delivery_id") REFERENCES "notification_deliveries"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "staff_replies" ADD CONSTRAINT "staff_replies_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "staff_replies" ADD CONSTRAINT "staff_replies_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "staff_replies" ADD CONSTRAINT "staff_replies_inbound_message_id_inbound_messages_id_fkey" FOREIGN KEY ("inbound_message_id") REFERENCES "inbound_messages"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "staff_replies" ADD CONSTRAINT "staff_replies_sent_by_person_id_people_id_fkey" FOREIGN KEY ("sent_by_person_id") REFERENCES "people"("id");