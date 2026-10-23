ALTER TABLE "waiver_records" ADD COLUMN "shop_answers" jsonb;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "draft_shop_answers" jsonb;--> statement-breakpoint
ALTER TABLE "waiver_templates" ADD COLUMN "questions" jsonb DEFAULT '[]' NOT NULL;