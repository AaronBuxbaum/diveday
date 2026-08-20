import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * Shapes for the one-tap waiver send, kept out of the `"use server"` action
 * file on purpose: a `"use server"` module may only export async functions, so
 * every other export there becomes a server-action reference at build time.
 * The client's initial `useActionState` value and its types must be real values
 * a client component can import, which is why they live here.
 */

/** Where the send happened, so the right route is revalidated after it lands. */
export type WaiverSendSurface = "today" | "blockers" | "check_in" | "roster" | "diver";

/**
 * Which way the shop asked DiveDay to hand the link over. Structurally the same
 * union as `WaiverSendChannel` in `src/db/waiver-issue.ts`, declared again here
 * because `src/db` may not import from `src/app` and this value has to be
 * readable by a Client Component (`pnpm check:architecture`). The two are
 * assigned across in `sendWaiversAction`, so a drift is a type error there
 * rather than a channel that silently means nothing.
 */
export const WAIVER_SEND_CHANNELS = ["email", "text", "link"] as const;
export type WaiverSendChannel = (typeof WAIVER_SEND_CHANNELS)[number];

export function isWaiverSendChannel(value: unknown): value is WaiverSendChannel {
  return (WAIVER_SEND_CHANNELS as readonly unknown[]).includes(value);
}

/** A private fallback link staff must hand over when a send did not go out. */
export type WaiverFallbackLink = {
  name: string;
  token: string;
  /** Why staff must hand this over themselves — a missing address reads very
   * differently from a shop that has no email provider wired up at all, and
   * both read differently from a deployment with no `APP_HOST` to build the
   * link on. Each gap points at a different setting, so each gets its own word.
   * `link_only` is not a gap at all: it is the staffer having asked for the URL
   * to pass on themselves. */
  reason:
    | "sent"
    | "link_only"
    | "no_email"
    | "no_phone"
    | "no_app_origin"
    | "unconfigured"
    | "test_recipient"
    | "failed";
};

export type WaiverSendState = {
  status: "idle" | "done";
  /**
   * Which button produced this outcome. The diver record's action row reads it
   * to decide whether to put the fresh link on the clipboard — a copy the
   * staffer asked for, never a surprise write behind an email send.
   */
  channel: WaiverSendChannel;
  /** Divers the email actually reached. */
  sent: string[];
  /** Divers with no email / no delivery configured — link shown to copy. */
  links: WaiverFallbackLink[];
  /** Divers who already have a signed waiver; nothing was reissued. */
  alreadyDone: string[];
  /** Divers whose send failed outright (no current booking/template). */
  errors: string[];
  /**
   * True when the submit carried neither booking ids nor a person id — only
   * reachable from the roster's bulk control with nothing selected.
   */
  emptySelection: boolean;
};

export const IDLE_WAIVER_SEND_STATE: WaiverSendState = {
  status: "idle",
  channel: "email",
  sent: [],
  links: [],
  alreadyDone: [],
  errors: [],
  emptySelection: false,
};

/** Copy for `WaiverSendControl` (a Client Component) — resolved server-side
 * from the staff bundle (`staff/<namespace>.json`) and passed down as plain data, the same pattern as
 * `ResendConfirmationCopy` and `WaitlistInviteCopy`. */
export type WaiverSendCopy = {
  /** Default pending label for the send button; a caller may override per-tap. */
  sending: string;
  copied: string;
  copyLink: string;
  copyFailed: string;
  reasonNoEmailOne: string;
  reasonNoEmailOther: string;
  reasonNoPhoneOne: string;
  reasonNoPhoneOther: string;
  /** The `link` channel's own line: nothing was sent because nothing was asked to be. */
  reasonLinkOnlyOne: string;
  reasonLinkOnlyOther: string;
  reasonFailedOne: string;
  reasonFailedOther: string;
  /**
   * The same two gaps, worded for the text channel. `failed` and `unconfigured`
   * are the only reasons whose wording has to name a channel — "Email could not
   * be delivered" about a text nobody emailed sends a shop to check the wrong
   * setting, which is the mistake `reasonNoAppOrigin` already exists to avoid.
   */
  reasonTextFailedOne: string;
  reasonTextFailedOther: string;
  reasonTestRecipientOne: string;
  reasonTestRecipientOther: string;
  reasonUnconfigured: string;
  reasonTextUnconfigured: string;
  reasonNoAppOrigin: string;
  /**
   * The whole outcome line — `"{reason} — share this private link:"`. It carries
   * the reason rather than being glued after one at the call site, because a
   * dash and the words either side of it are a sentence, and a sentence
   * assembled in JSX cannot be reordered by a translator.
   */
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
  /** Confirm/cancel labels for the resend guard (`InlineConfirm`'s message mode). */
  confirmResend: string;
  neverMind: string;
  /** The roster's bulk control, submitted with nothing ticked. */
  emptySelection: string;
};

/** Built once per page and threaded to every `WaiverSendControl` on it. */
export function waiverSendCopy(t: StaffTranslator): WaiverSendCopy {
  return {
    sending: t("shared.waiverSend.sending"),
    copied: t("shared.waiverSend.copied"),
    copyLink: t("shared.waiverSend.copyLink"),
    copyFailed: t("shared.waiverSend.copyFailed"),
    reasonNoEmailOne: t("shared.waiverSend.reasonNoEmailOne"),
    reasonNoEmailOther: t.raw("shared.waiverSend.reasonNoEmailOther"),
    reasonNoPhoneOne: t("shared.waiverSend.reasonNoPhoneOne"),
    reasonNoPhoneOther: t.raw("shared.waiverSend.reasonNoPhoneOther"),
    reasonLinkOnlyOne: t("shared.waiverSend.reasonLinkOnlyOne"),
    reasonLinkOnlyOther: t.raw("shared.waiverSend.reasonLinkOnlyOther"),
    reasonFailedOne: t("shared.waiverSend.reasonFailedOne"),
    reasonFailedOther: t.raw("shared.waiverSend.reasonFailedOther"),
    reasonTextFailedOne: t("shared.waiverSend.reasonTextFailedOne"),
    reasonTextFailedOther: t.raw("shared.waiverSend.reasonTextFailedOther"),
    reasonTestRecipientOne: t("shared.waiverSend.reasonTestRecipientOne"),
    reasonTestRecipientOther: t.raw("shared.waiverSend.reasonTestRecipientOther"),
    reasonUnconfigured: t("shared.waiverSend.reasonUnconfigured"),
    reasonTextUnconfigured: t("shared.waiverSend.reasonTextUnconfigured"),
    reasonNoAppOrigin: t("shared.waiverSend.reasonNoAppOrigin"),
    sharePrivateLinkOne: t.raw("shared.waiverSend.sharePrivateLinkOne"),
    sharePrivateLinkOther: t.raw("shared.waiverSend.sharePrivateLinkOther"),
    sent: t.raw("shared.waiverSend.sent"),
    alreadyDoneOne: t.raw("shared.waiverSend.alreadyDoneOne"),
    alreadyDoneOther: t.raw("shared.waiverSend.alreadyDoneOther"),
    errors: t.raw("shared.waiverSend.errors"),
    confirmResend: t("shared.waiverSend.confirmResend"),
    neverMind: t("shared.waiverSend.neverMind"),
    emptySelection: t("shared.waiverSend.emptySelection"),
  };
}
