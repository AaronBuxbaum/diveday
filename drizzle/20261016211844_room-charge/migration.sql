ALTER TYPE "order_collection" ADD VALUE 'room_charge';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "room_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "room_hotel" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_room_charge_names_room" CHECK (("collection"::text = 'room_charge') = ("room_number" is not null));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_room_hotel_only_on_room_charge" CHECK ("room_hotel" is null or "collection"::text = 'room_charge');