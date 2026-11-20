import type { StaffTranslator } from "@/i18n/staff-messages";
import type { PaymentActionCopy } from "./PaymentActionControl";

/** The words for the Today queue's payment control (copy link, resend invoice). */
export function paymentActionCopy(t: StaffTranslator): PaymentActionCopy {
  return {
    copyLink: t("today.paymentAction.copyLink"),
    linkCopied: t("today.paymentAction.linkCopied"),
    copyFailed: t("today.paymentAction.copyFailed"),
    resendInvoice: t("today.paymentAction.resendInvoice"),
    resending: t("today.paymentAction.resending"),
    invoiceResent: t("today.paymentAction.invoiceResent"),
    errors: {
      notFound: t("today.paymentAction.errors.notFound"),
      notOpen: t("today.paymentAction.errors.notOpen"),
      notConfigured: t("today.paymentAction.errors.notConfigured"),
      failed: t("today.paymentAction.errors.failed"),
      rateLimited: t("shared.limits.sendLimit", { thing: "invoices" }),
    },
  };
}
