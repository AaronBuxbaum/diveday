DROP INDEX "shop_whatsapp_accounts_waba_unique";--> statement-breakpoint
-- Refuse, rather than resolve, two shops holding one phone_number_id: which
-- shop keeps the number is a human call. See "One WABA, several shops" in
-- docs/engineering/whatsapp-cloud-api-runbook.md.
DO $$
DECLARE duplicates text;
BEGIN
  SELECT string_agg(phone_number_id || ': ' || shops, '; ')
    INTO duplicates
    FROM (
      SELECT phone_number_id, string_agg(shop_id::text, ', ' ORDER BY connected_at DESC) AS shops
        FROM shop_whatsapp_accounts
       GROUP BY phone_number_id
      HAVING count(*) > 1
    ) d;
  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'shop_whatsapp_accounts holds one phone_number_id for several shops (number: shop ids, newest connection first): %. Resolve by hand before deploying; see the WhatsApp runbook.', duplicates;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_whatsapp_accounts_phone_number_unique" ON "shop_whatsapp_accounts" ("phone_number_id");--> statement-breakpoint
CREATE INDEX "shop_whatsapp_accounts_waba_idx" ON "shop_whatsapp_accounts" ("waba_id");