CREATE TYPE "public"."booking_status" AS ENUM('booked', 'checked_in', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."person_role" AS ENUM('owner', 'manager', 'instructor', 'divemaster', 'captain', 'crew', 'customer');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" "booking_status" DEFAULT 'booked' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_roles" (
	"person_id" uuid NOT NULL,
	"role" "person_role" NOT NULL,
	CONSTRAINT "person_roles_person_id_role_pk" PRIMARY KEY("person_id","role")
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shops_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"status" "trip_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_roles" ADD CONSTRAINT "person_roles_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_trip_person_unique" ON "bookings" USING btree ("trip_id","person_id");--> statement-breakpoint
CREATE INDEX "bookings_trip_idx" ON "bookings" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "people_shop_idx" ON "people" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "trips_shop_starts_idx" ON "trips" USING btree ("shop_id","starts_at");