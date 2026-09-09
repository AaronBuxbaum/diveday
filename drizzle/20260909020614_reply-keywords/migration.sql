CREATE TYPE "inbound_keyword_intent" AS ENUM('cancel', 'move', 'confirm');--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "keyword_intent" "inbound_keyword_intent";--> statement-breakpoint
ALTER TABLE "staff_replies" ALTER COLUMN "sent_by_person_id" DROP NOT NULL;