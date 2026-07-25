CREATE TYPE "notification_provider_status" AS ENUM('sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed');--> statement-breakpoint
CREATE TABLE "inbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"mailbox_id" uuid,
	"provider_email_id" text NOT NULL UNIQUE,
	"from_email" text NOT NULL,
	"from_name" text,
	"to_email" text NOT NULL,
	"subject" text,
	"text_body" text DEFAULT '' NOT NULL,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"handled_at" timestamp with time zone,
	"handled_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_mailbox_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"mailbox_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"address" text NOT NULL UNIQUE,
	"label" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "provider_status" "notification_provider_status";--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "provider_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "provider_detail" text;--> statement-breakpoint
CREATE INDEX "inbound_emails_mailbox_received_idx" ON "inbound_emails" ("mailbox_id","received_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_provider_message_idx" ON "notification_deliveries" ("provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_mailbox_members_unique" ON "platform_mailbox_members" ("mailbox_id","person_id");--> statement-breakpoint
CREATE INDEX "platform_mailbox_members_person_idx" ON "platform_mailbox_members" ("person_id");--> statement-breakpoint
CREATE INDEX "platform_mailboxes_address_idx" ON "platform_mailboxes" ("address");--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_mailbox_id_platform_mailboxes_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "platform_mailboxes"("id");--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_handled_by_person_id_people_id_fkey" FOREIGN KEY ("handled_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "platform_mailbox_members" ADD CONSTRAINT "platform_mailbox_members_mailbox_id_platform_mailboxes_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "platform_mailboxes"("id");--> statement-breakpoint
ALTER TABLE "platform_mailbox_members" ADD CONSTRAINT "platform_mailbox_members_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");