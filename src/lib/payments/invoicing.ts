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
export type ResendInvoiceResult = { status: "sent" | "not_configured" | "failed" };
export type RefundInvoiceResult = {
  status: "refunded" | "not_configured" | "not_refundable" | "failed";
  refundId?: string;
  /**
   * What Stripe says it actually reversed, in minor units — read back off the
   * refund object rather than echoed from the request. A caller must record
   * *this*, not the amount it asked for: Stripe is the authority on what
   * moved, and it is the only party that can see refunds this app did not
   * make (a dispute, a reversal from the Stripe dashboard).
   */
  amountCents?: number;
};

export interface InvoicingProvider {
  createInvoice(request: CreateInvoiceRequest): Promise<CreateInvoiceResult>;
  voidInvoice(stripeAccountId: string, stripeInvoiceId: string): Promise<VoidInvoiceResult>;
  /**
   * Re-sends the email for an invoice already created and finalized (the
   * same `/send` call `createInvoice` makes best-effort on the way out) —
   * the Today queue's "resend invoice" row acts on an existing invoice, it
   * never creates a second one.
   */
  resendInvoice(stripeAccountId: string, stripeInvoiceId: string): Promise<ResendInvoiceResult>;
  /**
   * `idempotencyKey` — see CreateInvoiceRequest; a retry converges on one
   * Stripe refund.
   *
   * `amountCents` omitted reverses the whole captured amount, exactly as
   * before. Given, it reverses that much and leaves the rest — the same
   * optional-amount contract `refundCheckoutSession` already has, and the
   * reason the two now read alike (issue #699). The key is never derived
   * from the amount: two genuine part-refunds of the same size are two
   * refunds, not one retried (PAY-C1).
   */
  refundInvoice(
    stripeAccountId: string,
    stripeInvoiceId: string,
    idempotencyKey: string,
    amountCents?: number,
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
  /**
   * The current shape of "which charge paid this invoice". Stripe moved the
   * payment off the Invoice object and into a list of `invoice_payment`
   * records; `payment_intent` above is the older spelling, kept because this
   * repo sends no `Stripe-Version` header (see `stripe-api-version.test.ts`),
   * so which of the two an account returns depends on the API version that
   * account defaults to. Accept either rather than betting on one.
   */
  payments: z
    .object({
      data: z
        .array(
          z.object({
            is_default: z.boolean().optional(),
            status: z.string().optional(),
            payment: z
              .object({ payment_intent: z.string().min(1).nullable().optional() })
              .nullable()
              .optional(),
          }),
        )
        .default([]),
    })
    .nullable()
    .optional(),
});

/**
 * The payment intent that actually paid an invoice, under either shape.
 *
 * Prefers the invoice-payments list — it is what a current account returns,
 * and it is the only one that survives once the legacy field is gone — and
 * falls back to the flat field for an account still pinned to an older
 * version. Within the list, the default payment wins, then any settled one:
 * an invoice can carry several attempts, and refunding a failed one is not a
 * refund.
 *
 * Returning `null` here means genuinely nothing to refund. That distinction
 * matters because the caller turns it into `not_refundable`, which staff read
 * as "Stripe says there is no money here" — so it must never be the answer to
 * "we looked in the wrong field".
 */
function paidPaymentIntentId(invoice: z.infer<typeof invoiceResponseSchema>): string | null {
  const payments = invoice.payments?.data ?? [];
  const settled =
    payments.find((payment) => payment.is_default && payment.payment?.payment_intent) ??
    payments.find((payment) => payment.status === "paid" && payment.payment?.payment_intent) ??
    payments.find((payment) => payment.payment?.payment_intent);
  if (settled?.payment?.payment_intent) return settled.payment.payment_intent;

  const legacy = invoice.payment_intent;
  if (typeof legacy === "string") return legacy;
  return legacy?.id ?? null;
}

// `amount` is a non-negative **integer** count of minor units, matching every
// other amount this file parses. It is not pedantry: `refundOrder` hands this
// figure to `applyOrderUpdate` as the `reverseCents` delta, and a bare
// `z.number()` accepts a negative one — which subtracts through the clamp,
// *raising* `amount_paid_cents` above what the order ever held and *lowering*
// `refunded_cents`. A fractional one writes a non-integer into an integer
// column. Refusing it here means a malformed provider response fails the parse
// and lands on `failed`, where a caller can see it, rather than silently
// corrupting the ledger (CodeRabbit review on PR #949).
const refundResponseSchema = z.object({
  id: z.string().min(1),
  amount: z.number().int().nonnegative().optional(),
});

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

    async resendInvoice(stripeAccountId, stripeInvoiceId) {
      try {
        const response = await post(
          stripeAccountId,
          `/invoices/${stripeInvoiceId}/send`,
          new URLSearchParams(),
        );
        return { status: response.ok ? "sent" : "failed" };
      } catch {
        return { status: "failed" };
      }
    },

    async refundInvoice(stripeAccountId, stripeInvoiceId, idempotencyKey, amountCents) {
      try {
        // No `expand[]=payment_intent`. That parameter is not merely
        // redundant on a current account — Stripe rejects the whole request
        // with `parameter_unknown` ("This property cannot be expanded"), so
        // the invoice never came back and a staff refund died as a bare
        // `failed` with no money moved and nothing naming the cause. Both
        // shapes carry the intent *id* unexpanded, which is all a refund
        // needs, so ask for the plain object.
        const invoiceResponse = await fetchImpl(
          `https://api.stripe.com/v1/invoices/${stripeInvoiceId}`,
          { headers: headersFor(config.secretKey, stripeAccountId) },
        );
        if (!invoiceResponse.ok) return { status: "failed" };
        const invoiceBody = invoiceResponseSchema.safeParse(await invoiceResponse.json());
        if (!invoiceBody.success) return { status: "failed" };
        const paymentIntentId = paidPaymentIntentId(invoiceBody.data);
        if (!paymentIntentId) return { status: "not_refundable" };

        const form = new URLSearchParams({ payment_intent: paymentIntentId });
        // Only when asked. Stripe reads an absent `amount` as "all of it",
        // and sending the full figure explicitly would be a different
        // request that Stripe could reject on a rounding disagreement —
        // the same reason `refundCheckoutSession` omits it too.
        if (amountCents !== undefined) form.set("amount", String(amountCents));
        const response = await post(stripeAccountId, "/refunds", form, idempotencyKey);
        if (!response.ok) return { status: "failed" };
        const body = refundResponseSchema.safeParse(await response.json());
        return body.success
          ? { status: "refunded", refundId: body.data.id, amountCents: body.data.amount }
          : { status: "failed" };
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
  async resendInvoice() {
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
