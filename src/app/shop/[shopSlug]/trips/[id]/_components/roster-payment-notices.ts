/** Payment recording and party-split notices belong to the roster form. */
export const ROSTER_PAYMENT_NOTICES = {
  payment: { form: "roster", tone: "success", key: "trips.notices.payment" },
  "payment-amount": { form: "roster", tone: "danger", key: "trips.notices.paymentAmount" },
  "payment-method": { form: "roster", tone: "danger", key: "trips.notices.paymentMethod" },
  "payment-short": { form: "roster", tone: "danger", key: "trips.notices.paymentShort" },
  "payment-refund-amount": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.paymentRefundAmount",
  },
  "payment-currency": { form: "roster", tone: "danger", key: "trips.notices.paymentCurrency" },
  "payment-online": { form: "roster", tone: "danger", key: "trips.notices.paymentOnline" },
  "party-preview": { form: "roster", tone: "warning", key: "trips.notices.partyPreview" },
  "party-paid": { form: "roster", tone: "success", key: "trips.notices.partyPaid" },
  "party-paid-short": { form: "roster", tone: "warning", key: "trips.notices.partyPaidShort" },
  "party-over": { form: "roster", tone: "danger", key: "trips.notices.partyOver" },
  "party-nothing-owed": { form: "roster", tone: "danger", key: "trips.notices.partyNothingOwed" },
  "party-changed": { form: "roster", tone: "danger", key: "trips.notices.partyChanged" },
} as const;
