/**
 * DiveDay's own hosted mailboxes (docs/engineering/resend-email-runbook.md,
 * ADR 20260726-hosted-mailboxes-for-platform-mail). Not sent by the app —
 * real mailboxes set up with the mail provider — so these are just the
 * addresses, shared here so every surface that offers one renders the same
 * string.
 */

/** The founder-direct line, offered anywhere the product promises "reach a person" (docs/product/marketing.md). */
export const FOUNDER_EMAIL = "aaron@dive.day";

/** Where operational alerts (new signups, error monitoring) land — not diver- or shop-facing. */
export const ALERT_EMAIL = "alerts@dive.day";
