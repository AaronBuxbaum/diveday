-- diveday:allow-destructive drop-constraint last_minute_list_unsubscribe_tokens.last_minute_list_unsubscribe_tokens_AOSpe7xhTtoO_fkey: retired by #2912 with no serving runtime callers; pre-pilot, no users (H-49)
ALTER TABLE "last_minute_list_unsubscribe_tokens" DROP CONSTRAINT "last_minute_list_unsubscribe_tokens_AOSpe7xhTtoO_fkey";--> statement-breakpoint
-- diveday:allow-destructive drop-constraint trip_invitations.trip_invitations_course_inquiry_id_course_inquiries_id_fkey: retired by #2912 with no serving runtime callers; pre-pilot, no users (H-49)
ALTER TABLE "trip_invitations" DROP CONSTRAINT "trip_invitations_course_inquiry_id_course_inquiries_id_fkey";--> statement-breakpoint
-- diveday:allow-destructive drop-table course_inquiries: retired by #2912 with no serving runtime callers; pre-pilot, no users (H-49)
DROP TABLE "course_inquiries";--> statement-breakpoint
-- diveday:allow-destructive drop-table last_minute_list_entries: retired by #2912 with no serving runtime callers; pre-pilot, no users (H-49)
DROP TABLE "last_minute_list_entries";--> statement-breakpoint
-- diveday:allow-destructive drop-table last_minute_list_unsubscribe_tokens: retired by #2912 with no serving runtime callers; pre-pilot, no users (H-49)
DROP TABLE "last_minute_list_unsubscribe_tokens";--> statement-breakpoint
-- diveday:allow-destructive drop-table trip_invitations: retired by #2912 with no serving runtime callers; pre-pilot, no users (H-49)
DROP TABLE "trip_invitations";--> statement-breakpoint
-- diveday:allow-destructive drop-table trip_last_minute_promo_recipients: retired by #2912 with no serving runtime callers; pre-pilot, no users (H-49)
DROP TABLE "trip_last_minute_promo_recipients";--> statement-breakpoint
-- diveday:allow-destructive drop-table trip_waitlist_entries: retired by #2912 with no serving runtime callers; pre-pilot, no users (H-49)
DROP TABLE "trip_waitlist_entries";--> statement-breakpoint
-- diveday:allow-destructive drop-type course_inquiry_experience: retired by #2912 with no serving runtime callers; pre-pilot, no users (H-49)
DROP TYPE "course_inquiry_experience";--> statement-breakpoint
-- diveday:allow-destructive drop-type trip_invitation_source: retired by #2912 with no serving runtime callers; pre-pilot, no users (H-49)
DROP TYPE "trip_invitation_source";--> statement-breakpoint
-- diveday:allow-destructive drop-type course_inquiry_outcome: retired by #2912 with no serving runtime callers; pre-pilot, no users (H-49)
DROP TYPE "course_inquiry_outcome";
