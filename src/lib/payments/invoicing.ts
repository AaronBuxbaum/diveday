import { z } from "zod";

/**
 * Order/invoice creation on a shop's connected Stripe account. Every call
 * carries a `Stripe-Account` header so the shop, not the platform, is the
 * merchant of record (docs ADR 20260719-stripe-connect-orders). Fetch-based,
 * no SDK — same pattern as ./index.ts and ./connect.ts.
 */

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unitAmountCents: number;
};

export type CreateInvoiceRequest = {
  stripeAccountId: string;
  customerEmail: string;
  customerName: string;
  currency: string;
  lineItems: InvoiceLineItem[];
  /** Days a diver has to pay before the invoice is overdue; Stripe requires this for `send_invoice`. */
  daysUntilDue?: number;
  /**
   * Deterministic per-attempt key (`idempotencyKeyFor`,
   * src/db/payment-operations.ts). Invoice creation is several POSTs
   * (customer, invoiceitem(s), invoice, finalize) — each gets its own
   * `:step` suffix so a retry replays each step against the same Stripe
   * object it created the first time, never a second customer/item/invoice
   * (CR-005).
   */
  idempotencyKey: string;
};

export type CreatedInvoice = {
  stripeCustomerId: string;
  stripeInvoiceId: string;
  /** Stripe's own invoice status right after finalize — usually "open", but "paid" for a zero-total invoice. */
  stripeStatus: string;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  totalCents: number;
};

export type CreateInvoiceResult =
  | ({ status: "created" } & CreatedInvoice)
  | { status: "not_configured" }
  | { status: "failed" };

export type InvoiceSnapshot = {
  status: string;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  amountPaidCents: number;
  totalCents: number;
};

export type InvoiceLookupResult =
  | { status: "ok"; invoice: InvoiceSnapshot }
  | { status: "not_configured" }
  | { status: "failed" };

export type VoidInvoiceResult = { status: "voided" | "not_configured" | "failed" };
export type RefundInvoiceResult = {
  status: "refunded" | "not_configured" | "not_refundable" | "failed";
  refundId?: string;
};

export interface InvoicingProvider {
  createInvoice(request: CreateInvoiceRequest): Promise<CreateInvoiceResult>;
  voidInvoice(stripeAccountId: string, stripeInvoiceId: string): Promise<VoidInvoiceResult>;
  /** `idempotencyKey` — see CreateInvoiceRequest; a retry converges on one Stripe refund. */
  refundInvoice(
    stripeAccountId: string,
    stripeInvoiceId: string,
    idempotencyKey: string,
  ): Promise<RefundInvoiceResult>;
  retrieveInvoice(stripeAccountId: string, stripeInvoiceId: string): Promise<InvoiceLookupResult>;
}

type Fetch = typeof fetch;
type PaymentEnvironment = Readonly<Record<string, string | undefined>>;

const configSchema = z.object({ secretKey: z.string().trim().min(1) });

const customerResponseSchema = z.object({ id: z.string().min(1) });
const invoiceResponseSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  hosted_invoice_url: z.string().url().nullable().optional(),
  invoice_pdf: z.string().url().nullable().optional(),
  total: z.number().int(),
  amount_paid: z.number().int().optional(),
  payment_intent: z
    .union([z.string().min(1), z.object({ id: z.string().min(1) })])
    .nullable()
    .optional(),
});

const refundResponseSchema = z.object({ id: z.string().min(1) });

function headersFor(secretKey: string, stripeAccountId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Account": stripeAccountId,
  };
}

function toCreatedInvoice(body: z.infer<typeof invoiceResponseSchema>, stripeCustomerId: string) {
  return {
    stripeCustomerId,
    stripeInvoiceId: body.id,
    stripeStatus: body.status,
    hostedInvoiceUrl: body.hosted_invoice_url ?? null,
    invoicePdfUrl: body.invoice_pdf ?? null,
    totalCents: body.total,
  };
}

export function stripeInvoicingProvider(
  config: { secretKey: string },
  fetchImpl: Fetch,
): InvoicingProvider {
  async function post(
    stripeAccountId: string,
    path: string,
    form: URLSearchParams,
    idempotencyKey?: string,
  ) {
    return fetchImpl(`https://api.stripe.com/v1${path}`, {
      method: "POST",
      headers: {
        ...headersFor(config.secretKey, stripeAccountId),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: form.toString(),
    });
  }

  return {
    async createInvoice(request) {
      try {
        const key = request.idempotencyKey;
        const customerResponse = await post(
          request.stripeAccountId,
          "/customers",
          new URLSearchParams({ email: request.customerEmail, name: request.customerName }),
          `${key}:customer`,
        );
        if (!customerResponse.ok) return { status: "failed" };
        const customerBody = customerResponseSchema.safeParse(await customerResponse.json());
        if (!customerBody.success) return { status: "failed" };
        const stripeCustomerId = customerBody.data.id;

        for (const [index, item] of request.lineItems.entries()) {
          const itemResponse = await post(
            request.stripeAccountId,
            "/invoiceitems",
            new URLSearchParams({
              customer: stripeCustomerId,
              currency: request.currency,
              description: item.description,
              quantity: String(item.quantity),
              unit_amount: String(item.unitAmountCents),
            }),
            `${key}:item:${index}`,
          );
          if (!itemResponse.ok) return { status: "failed" };
        }

        const invoiceResponse = await post(
          request.stripeAccountId,
          "/invoices",
          new URLSearchParams({
            customer: stripeCustomerId,
            collection_method: "send_invoice",
            days_until_due: String(request.daysUntilDue ?? 7),
            auto_advance: "false",
          }),
          `${key}:invoice`,
        );
        if (!invoiceResponse.ok) return { status: "failed" };
        const invoiceBody = invoiceResponseSchema.safeParse(await invoiceResponse.json());
        if (!invoiceBody.success) return { status: "failed" };

        const finalizeResponse = await post(
          request.stripeAccountId,
          `/invoices/${invoiceBody.data.id}/finalize`,
          new URLSearchParams(),
          `${key}:finalize`,
        );
        if (!finalizeResponse.ok) return { status: "failed" };
        const finalizeBody = invoiceResponseSchema.safeParse(await finalizeResponse.json());
        if (!finalizeBody.success) return { status: "failed" };

        // Best-effort: staff can still share hosted_invoice_url if Stripe's own send fails.
        await post(
          request.stripeAccountId,
          `/invoices/${finalizeBody.data.id}/send`,
          new URLSearchParams(),
          `${key}:send`,
        ).catch(() => undefined);

        return { status: "created", ...toCreatedInvoice(finalizeBody.data, stripeCustomerId) };
      } catch {
        return { status: "failed" };
      }
    },

    async voidInvoice(stripeAccountId, stripeInvoiceId) {
      try {
        const response = await post(
          stripeAccountId,
          `/invoices/${stripeInvoiceId}/void`,
          new URLSearchParams(),
        );
        return { status: response.ok ? "voided" : "failed" };
      } catch {
        return { status: "failed" };
      }
    },

    async refundInvoice(stripeAccountId, stripeInvoiceId, idempotencyKey) {
      try {
        const invoiceResponse = await fetchImpl(
          `https://api.stripe.com/v1/invoices/${stripeInvoiceId}?expand[]=payment_intent`,
          { headers: headersFor(config.secretKey, stripeAccountId) },
        );
        if (!invoiceResponse.ok) return { status: "failed" };
        const invoiceBody = invoiceResponseSchema.safeParse(await invoiceResponse.json());
        if (!invoiceBody.success) return { status: "failed" };
        const paymentIntent = invoiceBody.data.payment_intent;
        const paymentIntentId =
          typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id;
        if (!paymentIntentId) return { status: "not_refundable" };

        const response = await post(
          stripeAccountId,
          "/refunds",
          new URLSearchParams({ payment_intent: paymentIntentId }),
          idempotencyKey,
        );
        if (!response.ok) return { status: "failed" };
        const body = refundResponseSchema.safeParse(await response.json());
        return body.success ? { status: "refunded", refundId: body.data.id } : { status: "failed" };
      } catch {
        return { status: "failed" };
      }
    },

    async retrieveInvoice(stripeAccountId, stripeInvoiceId) {
      try {
        const response = await fetchImpl(`https://api.stripe.com/v1/invoices/${stripeInvoiceId}`, {
          headers: headersFor(config.secretKey, stripeAccountId),
        });
        if (!response.ok) return { status: "failed" };
        const body = invoiceResponseSchema.safeParse(await response.json());
        if (!body.success) return { status: "failed" };
        return {
          status: "ok",
          invoice: {
            status: body.data.status,
            hostedInvoiceUrl: body.data.hosted_invoice_url ?? null,
            invoicePdfUrl: body.data.invoice_pdf ?? null,
            amountPaidCents: body.data.amount_paid ?? 0,
            totalCents: body.data.total,
          },
        };
      } catch {
        return { status: "failed" };
      }
    },
  };
}

const disabledInvoicingProvider: InvoicingProvider = {
  async createInvoice() {
    return { status: "not_configured" };
  },
  async voidInvoice() {
    return { status: "not_configured" };
  },
  async refundInvoice() {
    return { status: "not_configured" };
  },
  async retrieveInvoice() {
    return { status: "not_configured" };
  },
};

export function invoicingProviderFromEnvironment(
  env: PaymentEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): InvoicingProvider {
  const config = configSchema.safeParse({ secretKey: env.STRIPE_SECRET_KEY });
  return config.success
    ? stripeInvoicingProvider(config.data, fetchImpl)
    : disabledInvoicingProvider;
}
