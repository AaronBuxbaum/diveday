ALTER TABLE "unresolved_safety_alert_scan" ADD COLUMN "last_problem" text;--> statement-breakpoint
ALTER TABLE "unresolved_safety_alert_scan" ADD COLUMN "last_problem_sequence" bigint;--> statement-breakpoint
ALTER TABLE "unresolved_safety_alert_scan" ADD COLUMN "last_problem_at" timestamp with time zone;