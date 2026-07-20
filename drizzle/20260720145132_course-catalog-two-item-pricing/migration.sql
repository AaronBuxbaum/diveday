ALTER TYPE "order_line_item_kind" ADD VALUE 'e_learning_fee' BEFORE 'rental_gear';--> statement-breakpoint
ALTER TABLE "courses" DROP COLUMN "requires_instructor";--> statement-breakpoint
ALTER TABLE "courses" DROP COLUMN "requires_waiver";