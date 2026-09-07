/**
 * Shapes for the lobby-display panel, kept out of the `"use server"` action
 * file for the reason the calendar panel's are: a `"use server"` module may
 * only export async functions, and the client's initial `useActionState`
 * value has to be a real value it can import.
 */

export type DisplayLinkState =
  | { status: "idle" }
  | { status: "issued"; id: string; label: string; url: string }
  | { status: "revoked"; id: string }
  | { status: "invalid_label" }
  | { status: "denied" };

export const IDLE_DISPLAY_LINK_STATE: DisplayLinkState = { status: "idle" };

/**
 * Every word the panel renders, resolved on the server. Staff copy never
 * crosses to the client as a bundle (`src/i18n/staff-messages.ts`).
 */
export type DisplayLinkCopy = {
  createHeading: string;
  labelField: string;
  labelPlaceholder: string;
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
  denied: string;
  invalidLabel: string;
  revoked: string;
};

/** One live link as the list shows it, with dates already localized. */
export type DisplayLinkView = {
  id: string;
  label: string;
  showNames: boolean;
  createdLabel: string;
  /** Localized on the server; null when no screen has opened it yet. */
  lastShownLabel: string | null;
};
