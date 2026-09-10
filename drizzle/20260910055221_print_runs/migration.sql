CREATE TYPE "print_sheet" AS ENUM('dock_sign', 'window_sticker', 'boat_card', 'site_briefing', 'paper_pass');--> statement-breakpoint
CREATE TABLE "shop_print_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"sheet" "print_sheet" NOT NULL,
	"subject_key" text DEFAULT '' NOT NULL,
	"printed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "shop_print_runs_sheet_unique" ON "shop_print_runs" ("shop_id","sheet","subject_key");--> statement-breakpoint
ALTER TABLE "shop_print_runs" ADD CONSTRAINT "shop_print_runs_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");