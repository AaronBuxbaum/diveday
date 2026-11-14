CREATE TABLE "unresolved_safety_alert_escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"outbox_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unresolved_safety_alert_escalation_kind" CHECK ("kind" in ('no_recipients', 'uncertain', 'pending', 'dispatch_error'))
);
--> statement-breakpoint
CREATE TABLE "unresolved_safety_alert_scan" (
	"name" text PRIMARY KEY,
	"cursor" bigint DEFAULT 0 NOT NULL,
	"high_water" bigint,
	"lease_id" uuid,
	"lease_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unresolved_safety_alert_scan_lease_pair" CHECK (("lease_id" is null) = ("lease_until" is null))
);
--> statement-breakpoint
ALTER TABLE "unresolved_safety_alert_outbox" ADD COLUMN "scan_sequence" bigserial;--> statement-breakpoint
CREATE UNIQUE INDEX "unresolved_safety_alert_escalation_kind_unique" ON "unresolved_safety_alert_escalations" ("outbox_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "unresolved_safety_alert_outbox_scan_sequence_unique" ON "unresolved_safety_alert_outbox" ("scan_sequence");--> statement-breakpoint
ALTER TABLE "unresolved_safety_alert_escalations" ADD CONSTRAINT "unresolved_safety_alert_escalations_hMbe32MvQwWk_fkey" FOREIGN KEY ("outbox_id") REFERENCES "unresolved_safety_alert_outbox"("id");