ALTER TABLE "orders" ALTER COLUMN "person_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_anonymous_counter_only" CHECK ("person_id" is not null or (
      "counter_receipt" is not null and "booking_id" is null
      and "source"::text = 'staff'
      and "collection"::text in ('cash', 'card_machine', 'bank_transfer', 'other')
      and "status"::text in ('paid', 'partly_refunded', 'refunded', 'void')
      and "stripe_invoice_id" is null and "stripe_customer_id" is null
      and "stripe_payment_intent_id" is null and "stripe_account_id" is null
    ));