/** Unverified source evidence shared by the import journey and its report capture. */
export const PAYMENT_HISTORY_CSV = [
  "Full Name,Email,Payment Date,Payment Status,Payment Amount,Payment Currency,Payment Direction,Payment ID,Receipt Number,Receipt URL,Stripe Payment Intent ID",
  "Source Sloane,source.sloane@example.com,2026-03-04,Paid,USD 165.00,USD,Payment,legacy-pay-1001,REC-1001,/import-receipts/rec-1001.pdf,pi_legacy_1001",
  "Source Sloane,source.sloane@example.com,2026-03-05,Refunded,USD 25.00,USD,Refund,legacy-refund-1001,REC-1002,,pi_legacy_1002",
].join("\n");
