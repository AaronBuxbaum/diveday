CREATE TYPE "course_inquiry_outcome" AS ENUM('booked', 'done');--> statement-breakpoint
ALTER TABLE "course_inquiries" ADD COLUMN "handled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "course_inquiries" ADD COLUMN "handled_as" "course_inquiry_outcome";--> statement-breakpoint
ALTER TABLE "course_inquiries" ADD CONSTRAINT "course_inquiries_handled_together" CHECK (("handled_at" is null) = ("handled_as" is null));