import { z } from "zod";
import { getDb } from "@/db/client";
import { markOrderPaidByInvoiceId, markOrderVoidedByInvoiceId } from "@/db/orders";
import { disconnectShopStripeAccount, setShopStripeAccountStatus } from "@/db/stripe-accounts";
import { verifyStripeWebhook } from "@/lib/payments/webhook";

export const runtime = "nodejs";

const invoiceObjectSchema = z.object({
  id: z.string().min(1),
  amount_paid: z.number().int().optional(),
});

const accountObjectSchema = z.object({
  id: z.string().min(1),
  charges_enabled: z.boolean(),
  payouts_enabled: z.boolean(),
  details_submitted: z.boolean(),
});

/**
 * A single Connect webhook endpoint for every shop's connected account
 * (Stripe includes the connected account id as the event's top-level
 * `account` field). Fails closed on a bad/stale/missing signature before any
 * event is handled (docs ADR 20260719-stripe-connect-orders).
 */
export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  const verification = verifyStripeWebhook(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);

  if (verification.status === "not_configured") return new Response(null, { status: 503 });
  if (verification.status !== "verified") return new Response(null, { status: 400 });

  const { event } = verification;
  const db = await getDb();

  switch (event.type) {
    case "invoice.paid": {
      const invoice = invoiceObjectSchema.safeParse(event.data.object);
      if (invoice.success) {
        await markOrderPaidByInvoiceId(db, invoice.data.id, invoice.data.amount_paid ?? 0);
      }
      break;
    }
    case "invoice.voided": {
      const invoice = invoiceObjectSchema.safeParse(event.data.object);
      if (invoice.success) await markOrderVoidedByInvoiceId(db, invoice.data.id);
      break;
    }
    case "account.updated": {
      const account = accountObjectSchema.safeParse(event.data.object);
      if (account.success) {
        await setShopStripeAccountStatus(db, account.data.id, {
          chargesEnabled: account.data.charges_enabled,
          payoutsEnabled: account.data.payouts_enabled,
          detailsSubmitted: account.data.details_submitted,
        });
      }
      break;
    }
    case "account.application.deauthorized": {
      if (event.account) await disconnectShopStripeAccount(db, event.account);
      break;
    }
    default:
      // invoice.payment_failed and anything else: no local state change today.
      break;
  }

  return new Response(null, { status: 200 });
}
