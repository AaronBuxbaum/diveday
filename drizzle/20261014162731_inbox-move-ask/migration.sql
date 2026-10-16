ALTER TYPE "inbound_channel" ADD VALUE 'page';--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");