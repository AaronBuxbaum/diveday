ALTER TABLE "person_roles" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."person_role";--> statement-breakpoint
CREATE TYPE "public"."person_role" AS ENUM('owner', 'manager', 'instructor', 'divemaster', 'captain', 'crew', 'diver');--> statement-breakpoint
ALTER TABLE "person_roles" ALTER COLUMN "role" SET DATA TYPE "public"."person_role" USING "role"::"public"."person_role";