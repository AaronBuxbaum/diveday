/**
 * DiveDay's own hosted mailboxes (docs/engineering/ses-email-runbook.md,
 * ADR 20260726-hosted-mailboxes-for-platform-mail). Not sent by the app —
 * real mailboxes set up with the mail provider, all reaching the same small
 * team — so these are just the addresses, shared here so every surface that
 * offers one renders the same string.
 */

/**
 * General contact, offered anywhere the product promises "reach a person"
 * (docs/product/marketing.md). Deliberately not a named individual's address
 * — see the product-owner decision retiring the founder-direct-support claim
 * in docs/product/human-decisions.md.
 */
export const SUPPORT_EMAIL = "support@dive.day";

/** Where a trial shop's owner writes in to move to a paid plan. */
export const UPGRADE_EMAIL = "onboarding@dive.day";

/** Where operational alerts (new signups, error monitoring) land — not diver- or shop-facing. */
export const ALERT_EMAIL = "alerts@dive.day";
