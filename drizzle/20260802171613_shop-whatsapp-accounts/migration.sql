CREATE TABLE "shop_whatsapp_accounts" (
	"shop_id" uuid PRIMARY KEY,
	"phone_number_id" text NOT NULL,
	"display_phone_number" text,
	"waba_id" text,
	"access_token_sealed" text NOT NULL,
	"access_token_hint" text DEFAULT '' NOT NULL,
	"template_name" text NOT NULL,
	"template_language" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_whatsapp_accounts" ADD CONSTRAINT "shop_whatsapp_accounts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");