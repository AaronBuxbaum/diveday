CREATE TYPE "desk_payment" AS ENUM('card', 'cash', 'card_and_cash');--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "desk_payment" "desk_payment";