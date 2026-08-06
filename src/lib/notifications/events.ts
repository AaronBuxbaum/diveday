/**
 * The shared provider-status vocabulary every delivery-outcome webhook (SES,
 * SMS, WhatsApp) maps its own event names onto before handing off to
 * `applyProviderEmailEvent` (20260726-hosted-mailboxes-for-platform-mail) —
 * so the dashboard/issue-surfacing code downstream reads one status enum
 * regardless of which provider reported it.
 */
export type ProviderEmailStatus =
  | "sent"
  | "delivered"
  | "delivery_delayed"
  | "bounced"
  | "complained"
  | "failed"
  | "suppressed";

/**
 * Provider outcomes a shop must actually chase: the diver never got the email,
 * or told the provider it was spam. A delay is transient and a suppression is
 * already surfaced by the bounce that caused it.
 */
export const ACTIONABLE_PROVIDER_STATUSES = [
  "bounced",
  "complained",
  "failed",
] as const satisfies readonly ProviderEmailStatus[];
