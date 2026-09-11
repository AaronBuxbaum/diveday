/**
 * Shapes for the lobby-display panel, kept out of the `"use server"` action
 * file for the reason the calendar panel's are: a `"use server"` module may
 * only export async functions, and the client's initial `useActionState`
 * value has to be a real value it can import.
 */

export type DisplayLinkState =
  | { status: "idle" }
  // `purpose` rides along because the warning under the freshly-minted URL is
  // not the same sentence for the two kinds. A board link is read-only; a
  // check-in link **writes an arrival against a named diver**, and telling a
  // manager it "sees today's departures" at the exact moment they decide how
  // carefully to handle it is the wrong sentence (`security-reviewer` review).
  | { status: "issued"; id: string; label: string; url: string; purpose: "board" | "check_in" }
  | { status: "revoked"; id: string }
  // A renewed kiosk link keeps working; the row stays exactly where it was, so
  // the only thing that changes on screen is the expiry line and the notice.
  | { status: "renewed"; id: string }
  | { status: "invalid_label" }
  // Which act was refused, because the panel has two forms and a refusal shown
  // under the wrong one is worse than none: a staffer whose revoke was refused
  // read a message under a create form they never submitted.
  | { status: "denied"; intent: "issue" | "revoke" | "renew" };

export const IDLE_DISPLAY_LINK_STATE: DisplayLinkState = { status: "idle" };

/**
 * Every word the panel renders, resolved on the server. Staff copy never
 * crosses to the client as a bundle (`src/i18n/staff-messages.ts`).
 */
export type DisplayLinkCopy = {
  createHeading: string;
  labelField: string;
  labelPlaceholder: string;
  /** The two things a link can open, and the legend above the choice. */
  purposeLegend: string;
  purposeBoard: string;
  purposeCheckIn: string;
  purposeCheckInDescription: string;
  showNames: string;
  showNamesDescription: string;
  submit: string;
  submitting: string;
  newLinkHeading: string;
  shownOnce: string;
  copy: string;
  copied: string;
  copyFailed: string;
  shared: string;
  /** The same warning for a link that records arrivals rather than showing a board. */
  sharedCheckIn: string;
  listHeading: string;
  listEmpty: string;
  namesOn: string;
  namesOff: string;
  neverShown: string;
  revoke: string;
  revoking: string;
  confirmRevoke: string;
  confirmRevokeButton: string;
  cancel: string;
  renew: string;
  renewing: string;
  denied: string;
  invalidLabel: string;
  revoked: string;
  renewed: string;
  /** What a freshly minted check-in link's lifetime is, said as it is copied. */
  expiresCheckIn: string;
};

/** One live link as the list shows it, with dates already localized. */
export type DisplayLinkView = {
  id: string;
  label: string;
  /** "Departures board" / "Self check-in" — resolved on the server. */
  purposeLabel: string;
  /** Only a board link says anything about names; a kiosk names one diver, to that diver. */
  showNamesLabel: string | null;
  createdLabel: string;
  /** Localized on the server; null when no screen has opened it yet. */
  lastShownLabel: string | null;
  /**
   * The revoke button's accessible name, "Revoke Lobby TV". Never rendered —
   * the visible label stays "Revoke". Two screens otherwise announce as
   * "Revoke, button" twice, and the screen's own name sits in a sibling
   * paragraph outside the button, so it is not part of the accessible name.
   */
  revokeLabel: string;
  /**
   * "Expires 12 Mar 2027" or "Expired 12 Mar 2026", already localized; null for
   * a board link, which never expires. Its presence is also what decides
   * whether the row gets a Renew button — the two are the same fact.
   */
  expiresLabel: string | null;
  /** The renew button's accessible name, "Renew Counter tablet" — see `revokeLabel`. */
  renewLabel: string;
};
