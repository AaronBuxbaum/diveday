import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * Shapes for the one-tap waiver send, kept out of the `"use server"` action
 * file on purpose: a `"use server"` module may only export async functions, so
 * every other export there becomes a server-action reference at build time.
 * The client's initial `useActionState` value and its types must be real values
 * a client component can import, which is why they live here.
 */

/** Where the send happened, so the right route is revalidated after it lands. */
export type WaiverSendSurface = "today" | "blockers" | "check_in" | "roster";

/** A private fallback link staff must hand over when email did not go out. */
export type WaiverFallbackLink = {
  name: string;
  token: string;
  /** Why staff must hand this over themselves — a missing address reads very
   * differently from a shop that has no email provider wired up at all. */
  reason: "no_email" | "unconfigured" | "test_recipient" | "failed";
};

export type WaiverSendState = {
  status: "idle" | "done";
  /** Divers the email actually reached. */
  sent: string[];
  /** Divers with no email / no delivery configured — link shown to copy. */
  links: WaiverFallbackLink[];
  /** Divers who already have a signed waiver; nothing was reissued. */
  alreadyDone: string[];
  /** Divers whose send failed outright (no current booking/template). */
  errors: string[];
};

export const IDLE_WAIVER_SEND_STATE: WaiverSendState = {
  status: "idle",
  sent: [],
  links: [],
  alreadyDone: [],
  errors: [],
};

/** Copy for `WaiverSendControl` (a Client Component) — resolved server-side
 * from `staff.json` and passed down as plain data, the same pattern as
 * `ResendConfirmationCopy` and `WaitlistInviteCopy`. */
export type WaiverSendCopy = {
  /** Default pending label for the send button; a caller may override per-tap. */
  sending: string;
  copied: string;
  copyLink: string;
  reasonNoEmailOne: string;
  reasonNoEmailOther: string;
  reasonFailedOne: string;
  reasonFailedOther: string;
  reasonTestRecipientOne: string;
  reasonTestRecipientOther: string;
  reasonUnconfigured: string;
  sharePrivateLinkOne: string;
  sharePrivateLinkOther: string;
  /** "Waiver sent to {names}." */
  sent: string;
  /** "{names} already has a signed waiver — nothing reissued." */
  alreadyDoneOne: string;
  /** "{names} already have a signed waiver — nothing reissued." */
  alreadyDoneOther: string;
  /** "Couldn't send to {names} — open the roster to check the booking." */
  errors: string;
};

/** Built once per page and threaded to every `WaiverSendControl` on it. */
export function waiverSendCopy(t: StaffTranslator): WaiverSendCopy {
  return {
    sending: t("shared.waiverSend.sending"),
    copied: t("shared.waiverSend.copied"),
    copyLink: t("shared.waiverSend.copyLink"),
    reasonNoEmailOne: t("shared.waiverSend.reasonNoEmailOne"),
    reasonNoEmailOther: t("shared.waiverSend.reasonNoEmailOther"),
    reasonFailedOne: t("shared.waiverSend.reasonFailedOne"),
    reasonFailedOther: t("shared.waiverSend.reasonFailedOther"),
    reasonTestRecipientOne: t("shared.waiverSend.reasonTestRecipientOne"),
    reasonTestRecipientOther: t("shared.waiverSend.reasonTestRecipientOther"),
    reasonUnconfigured: t("shared.waiverSend.reasonUnconfigured"),
    sharePrivateLinkOne: t("shared.waiverSend.sharePrivateLinkOne"),
    sharePrivateLinkOther: t("shared.waiverSend.sharePrivateLinkOther"),
    sent: t("shared.waiverSend.sent"),
    alreadyDoneOne: t("shared.waiverSend.alreadyDoneOne"),
    alreadyDoneOther: t("shared.waiverSend.alreadyDoneOther"),
    errors: t("shared.waiverSend.errors"),
  };
}
