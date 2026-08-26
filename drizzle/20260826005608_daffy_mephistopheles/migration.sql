CREATE TYPE "integration_connection_status" AS ENUM('connected', 'error');--> statement-breakpoint
CREATE TYPE "integration_delivery_status" AS ENUM('pending', 'processing', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "integration_provider" AS ENUM('shopify', 'quickbooks', 'zapier');--> statement-breakpoint
CREATE TABLE "integration_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"status" "integration_delivery_status" DEFAULT 'pending'::"integration_delivery_status" NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"state_hash" text NOT NULL,
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"context" jsonb DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"integration_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"operation" text NOT NULL,
	"external_id" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"status" "integration_connection_status" DEFAULT 'connected'::"integration_connection_status" NOT NULL,
	"external_account_id" text,
	"external_label" text,
	"credentials_sealed" text NOT NULL,
	"settings" jsonb DEFAULT '{}' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_deliveries_integration_event_unique" ON "integration_deliveries" ("integration_id","event_id");--> statement-breakpoint
CREATE INDEX "integration_deliveries_due_idx" ON "integration_deliveries" ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "integration_deliveries_shop_created_idx" ON "integration_deliveries" ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_events_shop_idempotency_unique" ON "integration_events" ("shop_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "integration_events_shop_created_idx" ON "integration_events" ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_oauth_states_hash_unique" ON "integration_oauth_states" ("state_hash");--> statement-breakpoint
CREATE INDEX "integration_oauth_states_expiry_idx" ON "integration_oauth_states" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_records_source_unique" ON "integration_sync_records" ("integration_id","source_type","source_id","operation");--> statement-breakpoint
CREATE INDEX "integration_sync_records_external_idx" ON "integration_sync_records" ("integration_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_integrations_shop_provider_unique" ON "shop_integrations" ("shop_id","provider");--> statement-breakpoint
CREATE INDEX "shop_integrations_shop_status_idx" ON "shop_integrations" ("shop_id","status");--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_integration_id_shop_integrations_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "shop_integrations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_event_id_integration_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "integration_events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_oauth_states" ADD CONSTRAINT "integration_oauth_states_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_oauth_states" ADD CONSTRAINT "integration_oauth_states_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_sync_records" ADD CONSTRAINT "integration_sync_records_vVIWgqTqpGfj_fkey" FOREIGN KEY ("integration_id") REFERENCES "shop_integrations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "shop_integrations" ADD CONSTRAINT "shop_integrations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;