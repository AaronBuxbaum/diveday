import type { FeedScope } from "@/features/calendar-sync";

/**
 * Shapes for the calendar subscription panel, kept out of the `"use server"`
 * action file on purpose: a `"use server"` module may only export async
 * functions, so every other export there becomes a server-action reference at
 * build time. The client's initial `useActionState` value and its types must
 * be real values a client component can import.
 */

export type FeedIssueState =
  | { status: "idle" }
  | { status: "issued"; scope: FeedScope; webcalUrl: string; httpsUrl: string; rotated: boolean }
  | { status: "revoked"; scope: FeedScope }
  | { status: "denied" };

export const IDLE_FEED_ISSUE_STATE: FeedIssueState = { status: "idle" };

/** One subscribable scope as the panel shows it, with dates already localized. */
export type FeedScopeView = {
  scope: FeedScope;
  name: string;
  detail: string;
  /** Localized on the server; null when there is no live subscription. */
  subscribedLabel: string | null;
  /** Localized on the server; null when no calendar has fetched it yet. */
  lastReadLabel: string | null;
};
