CREATE TABLE "person_courtesy_email_unsubscribe_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "courtesy_email_opt_out_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "person_courtesy_email_unsubscribe_tokens_token_hash_idx" ON "person_courtesy_email_unsubscribe_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "person_courtesy_email_unsubscribe_tokens_person_idx" ON "person_courtesy_email_unsubscribe_tokens" ("person_id");--> statement-breakpoint
ALTER TABLE "person_courtesy_email_unsubscribe_tokens" ADD CONSTRAINT "person_courtesy_email_unsubscribe_tokens_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "person_courtesy_email_unsubscribe_tokens" ADD CONSTRAINT "person_courtesy_email_unsubscribe_tokens_IiziwZo2Y62C_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");