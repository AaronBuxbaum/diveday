CREATE TYPE "waiver_signed_via" AS ENUM('thread', 'counter', 'party_door', 'release_link', 'desk');--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "signed_via" "waiver_signed_via";