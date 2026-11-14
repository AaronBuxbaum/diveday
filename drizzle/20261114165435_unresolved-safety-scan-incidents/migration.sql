CREATE TABLE "unresolved_safety_scan_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"outbox_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"scan_sequence" bigint NOT NULL,
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "unresolved_safety_scan_incident_generation_unique" ON "unresolved_safety_scan_incidents" ("outbox_id","generation_id","scan_sequence");