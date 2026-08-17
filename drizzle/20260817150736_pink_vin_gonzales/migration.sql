CREATE TYPE "dive_mode" AS ENUM('boat', 'shore', 'pool');--> statement-breakpoint
CREATE TABLE "boats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "has_shore_diving" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "has_pool_diving" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "dive_mode" "dive_mode" DEFAULT 'boat'::"dive_mode" NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "boat_id" uuid;--> statement-breakpoint
CREATE INDEX "boats_shop_id_idx" ON "boats" ("shop_id");--> statement-breakpoint
ALTER TABLE "boats" ADD CONSTRAINT "boats_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_boat_id_boats_id_fkey" FOREIGN KEY ("boat_id") REFERENCES "boats"("id") ON DELETE SET NULL;