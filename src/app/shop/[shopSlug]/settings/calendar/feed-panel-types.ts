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

/**
 * Every word the panel renders, resolved on the server.
 *
 * Staff copy is server-translated and crosses to the client as props rather
 * than as a message bundle — see the note in `src/i18n/staff-messages.ts`. A
 * hardcoded English string in the client component would be a
 * `pnpm check:copy` failure.
 */
export type CalendarFeedCopy = {
  create: string;
  creating: string;
  rotate: string;
  rotating: string;
  turnOff: string;
  turningOff: string;
  copy: string;
  copied: string;
  confirmRotate: string;
  confirmTurnOff: string;
  newLinkHeading: string;
  shownOnce: string;
  webcalLabel: string;
  httpsLabel: string;
  webcalHint: string;
  httpsHint: string;
  rotateWarning: string;
  sharedWarning: string;
  denied: string;
  statusNone: string;
  neverRead: string;
};

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
