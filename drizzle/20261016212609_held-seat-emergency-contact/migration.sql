ALTER TABLE "bookings" ADD COLUMN "held_emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "held_emergency_contact_phone" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_held_emergency_contact_pair" CHECK (("held_emergency_contact_name" is null) = ("held_emergency_contact_phone" is null));