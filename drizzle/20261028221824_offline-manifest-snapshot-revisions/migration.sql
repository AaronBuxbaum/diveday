CREATE TABLE "offline_manifest_snapshot_revisions" (
	"shop_id" uuid,
	"trip_id" uuid,
	"revision" integer NOT NULL,
	CONSTRAINT "offline_manifest_snapshot_revisions_pk" PRIMARY KEY("shop_id","trip_id"),
	CONSTRAINT "offline_manifest_snapshot_revisions_positive" CHECK ("revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "offline_manifest_snapshot_revisions" ADD CONSTRAINT "offline_manifest_snapshot_revisions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "offline_manifest_snapshot_revisions" ADD CONSTRAINT "offline_manifest_snapshot_revisions_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;