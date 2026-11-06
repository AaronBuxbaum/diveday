import type { SendHoldCopy } from "@/components/SendHold";
import { sendHoldCopy } from "@/components/send-hold-copy";
import type { HeldSendOutcome } from "@/db/held-sends";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * Shapes for the one-tap waiver send, kept out of the `"use server"` action
 * file on purpose: a `"use server"` module may only export async functions, so
 * every other export there becomes a server-action reference at build time.
 * The client's initial `useActionState` value and its types must be real values
 * a client component can import, which is why they live here.
 */

/**
 * Where the send happened, so the right route is revalidated after it lands
 * and the send is counted where it was made. `counter` is a counter rental:
 * its ticket, or the new-rental form before there is one (issue #2346).
 */
export type WaiverSendSurface = "today" | "roster" | "diver" | "counter";

/**
 * Which way the shop asked DiveDay to hand the link over. Structurally the same
 * union as `WaiverSendChannel` in `src/db/waiver-issue.ts`, declared again here
 * because `src/db` may not import from `src/app` and this value has to be
 * readable by a Client Component (`pnpm check:architecture`). The two are
 * assigned across in `sendWaiversAction`, so a drift is a type error there
 * rather than a channel that silently means nothing.
 */
export const WAIVER_SEND_CHANNELS = ["email", "sms", "link"] as const;
export type WaiverSendChannel = (typeof WAIVER_SEND_CHANNELS)[number];

export function isWaiverSendChannel(value: unknown): value is WaiverSendChannel {
  return (WAIVER_SEND_CHANNELS as readonly unknown[]).includes(value);
}

/** A private fallback link staff must hand over when a send did not go out. */
export type WaiverFallbackLink = {
  name: string;
  /**
   * Null for a booked seat: its release is the holder's thread link, which
   * goes only to their contact on file and is never handed to staff (ADR
   * 20261105-waiver-folds-into-the-thread). The row then shows the reason and
   * "Send by text", never a link.
   */
  token: string | null;
  /** The seat a null-token row is about, so its "Send by text" knows where to post. */
  bookingId?: string;
  /**
   * The seat's record holds a number a text can reach. "Send by text" is
   * offered only then (issue #3984): without one it could only fail.
   */
  textable?: boolean;
  /**
   * The link's own path when it is not the release's: a signed release with
   * course forms still owed hands over `/ready/<token>/forms` (ADR
   * 20261008-course-forms). Absent means `/waivers/<token>` — `waiverLinkPath`.
   */
  path?: string;
  /** Why staff must hand this over themselves — a missing address reads very
   * differently from a shop that has no email provider wired up at all, and
   * both read differently from a deployment with no `APP_HOST` to build the
   * link on. Each gap points at a different setting, so each gets its own word.
   * `link_only` is not a gap at all: it is the staffer having asked for the URL
   * to pass on themselves, so it renders the copy control and no sentence.
   * `thread_only` is a Copy link tap on a booked seat, which has no link to
   * copy. `guardian_needed` is a minor whose address the party's lead typed:
   * nothing was sent (issue #4003). `guardian_check` is Copy link on a
   * minor's release with no seat, before the desk said a parent or guardian
   * is at the counter: nothing was minted (issue #4019). */
  reason:
    | "link_only"
    | "thread_only"
    | "guardian_needed"
    | "guardian_check"
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
 * `ResendConfirmationCopy` and `OfferSeatCopy`. */
export type WaiverSendCopy = {
  /** The held send's undo row (ADR 20260906-before-you-ask, decision 2). */
  hold: SendHoldCopy;
  /** Default pending label for the send button; a caller may override per-tap. */
  sending: string;
  copied: string;
  copyLink: string;
  copyFailed: string;
  sendByText: string;
  reasonThreadOnly: string;
  reasonGuardianNeeded: string;
  /** Copy link on a minor's release with no seat: the desk's question, and its yes (#4019). */
  guardianCheck: string;
  guardianConfirm: string;
  /** The diver record's word for a minor's release with no seat that went nowhere (#4019). */
  reasonGuardianNeededRelease: string;
  reasonNoEmailOne: string;
  reasonNoEmailOther: string;
  reasonNoPhoneOne: string;
  reasonNoPhoneOther: string;
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
  /** Stands in for a held send's name that came back empty. */
  unnamedDiver: string;
};

/** Built once per page and threaded to every `WaiverSendControl` on it. */
export function waiverSendCopy(t: StaffTranslator): WaiverSendCopy {
  return {
    hold: sendHoldCopy(t),
    sending: t("words.busy.sending"),
    copied: t("words.did.copied"),
    copyLink: t("shared.waiverSend.copyLink"),
    copyFailed: t("shared.waiverSend.copyFailed"),
    sendByText: t("shared.waiverSend.sendByText"),
    reasonThreadOnly: t("shared.waiverSend.reasonThreadOnly"),
    reasonGuardianNeeded: t("shared.waiverSend.reasonGuardianNeeded"),
    guardianCheck: t("shared.waiverSend.guardianCheck"),
    guardianConfirm: t("shared.waiverSend.guardianConfirm"),
    reasonGuardianNeededRelease: t("shared.waiverSend.reasonGuardianNeededRelease"),
    reasonNoEmailOne: t("shared.waiverSend.reasonNoEmailOne"),
    reasonNoEmailOther: t.raw("shared.waiverSend.reasonNoEmailOther"),
    reasonNoPhoneOne: t("shared.waiverSend.reasonNoPhoneOne"),
    reasonNoPhoneOther: t.raw("shared.waiverSend.reasonNoPhoneOther"),
    reasonFailedOne: t("shared.waiverSend.reasonFailedOne"),
    reasonFailedOther: t.raw("shared.waiverSend.reasonFailedOther"),
    reasonTextFailedOne: t("shared.waiverSend.reasonTextFailedOne"),
    reasonTextFailedOther: t.raw("shared.waiverSend.reasonTextFailedOther"),
    reasonTestRecipientOne: t("shared.waiverSend.reasonTestRecipientOne"),
    reasonTestRecipientOther: t.raw("shared.waiverSend.reasonTestRecipientOther"),
    reasonUnconfigured: t("shared.waiverSend.reasonUnconfigured"),
    reasonTextUnconfigured: t("shared.waiverSend.reasonTextUnconfigured"),
    reasonNoAppOrigin: t("shared.waiverSend.reasonNoAppOrigin"),
    sent: t.raw("shared.waiverSend.sent"),
    alreadyDoneOne: t.raw("shared.waiverSend.alreadyDoneOne"),
    alreadyDoneOther: t.raw("shared.waiverSend.alreadyDoneOther"),
    errors: t.raw("shared.waiverSend.errors"),
    confirmResend: t("shared.waiverSend.confirmResend"),
    neverMind: t("words.dismiss.neverMind"),
    emptySelection: t("shared.waiverSend.emptySelection"),
    unnamedDiver: t("shared.waiverSend.unnamedDiver"),
  };
}

/**
 * A held send's outcome (`src/db/held-sends.ts`) in the shape every waiver
 * surface renders. Names arrive as the executor found them; an empty name is
 * `unnamedDiver`, the word the immediate path always used.
 */
export function waiverSendStateFromOutcome(
  outcome: HeldSendOutcome,
  unnamedDiver: string,
): WaiverSendState {
  if (outcome.kind !== "waiver_send") return IDLE_WAIVER_SEND_STATE;
  const named = (names: string[]) => names.map((name) => name || unnamedDiver);
  return {
    status: "done",
    channel: outcome.channel,
    sent: named(outcome.sent),
    // A link is handed over only when the send did not land, so `sent` never
    // reaches here; the narrowing keeps the type honest rather than the data.
    links: outcome.links.map((link) => ({
      ...link,
      reason: link.reason === "sent" ? "failed" : link.reason,
    })),
    alreadyDone: named(outcome.alreadyDone),
    errors: named(outcome.errors),
    emptySelection: false,
  };
}

/**
 * The path a fallback link opens: its own when it carries one, the release's
 * otherwise; null for a booked seat, which has no link to hand over.
 */
export function waiverLinkPath(link: Pick<WaiverFallbackLink, "token" | "path">): string | null {
  if (link.path) return link.path;
  return link.token ? `/waivers/${link.token}` : null;
}
