ALTER TABLE "shops" ADD COLUMN "notice_text" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "storefront_leads" text DEFAULT 'schedule' NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_storefront_leads_known" CHECK ("storefront_leads" in ('schedule', 'courses'));