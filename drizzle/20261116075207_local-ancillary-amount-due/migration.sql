ALTER TYPE "order_collection" ADD VALUE 'local_invoice' BEFORE 'cash';--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_local_invoice_unpaid" CHECK ("collection"::text <> 'local_invoice' or (
      "person_id" is not null and "booking_id" is null and "source"::text = 'staff'
      and "status"::text in ('open', 'void') and "amount_paid_cents" = 0
      and "counter_receipt" is null and "total_cents" > 0
      and "stripe_account_id" is null and "stripe_customer_id" is null
      and "stripe_invoice_id" is null and "stripe_payment_intent_id" is null
    ));