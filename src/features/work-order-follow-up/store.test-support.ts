import type {
  CreateInvoiceRequest,
  CreateInvoiceResult,
  InvoicingProvider,
} from "../../lib/payments/invoicing";

export function fakeInvoicing(): InvoicingProvider & { created: CreateInvoiceRequest[] } {
  const created: CreateInvoiceRequest[] = [];
  return {
    created,
    async createInvoice(request): Promise<CreateInvoiceResult> {
      created.push(request);
      const n = created.length;
      return {
        status: "created",
        stripeCustomerId: `cus_wo_${n}`,
        stripeInvoiceId: `in_wo_${n}`,
        stripeStatus: "open",
        hostedInvoiceUrl: `https://invoice.stripe.com/i/in_wo_${n}`,
        invoicePdfUrl: null,
        totalCents: request.lineItems.reduce(
          (sum, item) => sum + item.quantity * item.unitAmountCents,
          0,
        ),
        taxCents: 0,
      };
    },
    async markInvoicePaidOutOfBand() {
      return { status: "paid" as const };
    },
    async voidInvoice() {
      return { status: "voided" };
    },
    async resendInvoice() {
      return { status: "sent" };
    },
    async refundInvoice() {
      return { status: "failed" };
    },
    async retrieveInvoice() {
      return { status: "failed" };
    },
  };
}
