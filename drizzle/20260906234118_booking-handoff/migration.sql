ALTER TYPE "booking_capability_purpose" ADD VALUE 'handoff';--> statement-breakpoint
ALTER TYPE "notification_kind" ADD VALUE 'booking_handoff' BEFORE 'readiness_link';