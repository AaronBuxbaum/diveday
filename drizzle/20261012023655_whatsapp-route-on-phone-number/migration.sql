DROP INDEX "shop_whatsapp_accounts_waba_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "shop_whatsapp_accounts_phone_number_unique" ON "shop_whatsapp_accounts" ("phone_number_id");--> statement-breakpoint
CREATE INDEX "shop_whatsapp_accounts_waba_idx" ON "shop_whatsapp_accounts" ("waba_id");