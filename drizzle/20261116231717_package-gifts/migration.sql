CREATE TABLE "package_gifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"send_on" date NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "package_gifts_order_unique" ON "package_gifts" ("order_id");--> statement-breakpoint
CREATE INDEX "package_gifts_person_idx" ON "package_gifts" ("person_id");--> statement-breakpoint
CREATE INDEX "package_gifts_unsent_idx" ON "package_gifts" ("send_on") WHERE "sent_at" is null;--> statement-breakpoint
ALTER TABLE "package_gifts" ADD CONSTRAINT "package_gifts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "package_gifts" ADD CONSTRAINT "package_gifts_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "package_gifts" ADD CONSTRAINT "package_gifts_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");