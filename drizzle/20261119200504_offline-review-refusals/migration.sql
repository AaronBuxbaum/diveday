CREATE TABLE "offline_review_refusals" (
	"shop_id" uuid,
	"client_event_id" uuid,
	CONSTRAINT "offline_review_refusals_pk" PRIMARY KEY("shop_id","client_event_id")
);
--> statement-breakpoint
ALTER TABLE "offline_review_refusals" ADD CONSTRAINT "offline_review_refusals_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;