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

/**
 * Where a shop writes in to be set up, and where a trial shop's owner writes in
 * to move to a paid plan. Every shop is opened by hand from this inbox (ADR
 * 20260925-shops-are-set-up-by-hand), so every public "Get set up" door is a
 * mail to it.
 */
export const ONBOARDING_EMAIL = "onboarding@dive.day";

/**
 * The public "Get set up" door: a mail to {@link ONBOARDING_EMAIL} with the
 * subject already written, in the reader's language (the caller passes it from
 * the bundle, because this file is shared with code that has no locale).
 */
export function setUpMailto(subject: string): string {
  return `mailto:${ONBOARDING_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

/** Where operational alerts (new signups, error monitoring) land — not diver- or shop-facing. */
export const ALERT_EMAIL = "alerts@dive.day";

/**
 * The address an operational alert is actually addressed to.
 *
 * `ALERT_EMAIL` is the mailbox *this* deployment ships with; `OPS_ALERT_EMAIL`
 * overrides it so a staging deploy, a fork, or a self-hosted instance points
 * its own inbox at its own signups instead of mailing DiveDay's founder about
 * shops that aren't ours. Read through the function rather than the constant at
 * every alerting call site, so the override can never be honoured on one path
 * and missed on another.
 *
 * Server-only in practice — every caller is a server action — and the env
 * argument is injectable the same way `notificationProviderFromEnvironment`
 * takes one, so the fallback is testable without stubbing globals.
 */
export function alertRecipient(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return env.OPS_ALERT_EMAIL?.trim() || ALERT_EMAIL;
}
