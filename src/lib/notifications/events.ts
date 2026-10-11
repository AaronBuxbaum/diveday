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

/**
 * When a provider says an event happened, or `fallback` when it says nothing
 * usable. The first candidate that reads as an instant wins, so a parser can
 * list the event-specific timestamp before the envelope's.
 *
 * `"iso"` reads an ISO-8601 string (SES, SNS SMS receipts); `"epoch-seconds"`
 * reads Meta's decimal seconds since the epoch (WhatsApp), where zero or a
 * negative number is as unusable as garbage. One reader, so the three
 * delivery-receipt parsers cannot disagree about what a bad timestamp means.
 */
export function timestampFrom(
  candidates: readonly (string | undefined)[],
  fallback: Date,
  format: "iso" | "epoch-seconds" = "iso",
): Date {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (format === "epoch-seconds") {
      const seconds = Number(candidate);
      if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1_000);
      continue;
    }
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}
