"use client";

import Link from "next/link";
import { useState } from "react";
import {
  holdSendAction,
  releaseHeldSendAction,
  undoHeldSendAction,
} from "@/app/actions/held-sends";
import {
  IDLE_WAIVER_SEND_STATE,
  type WaiverFallbackLink,
  type WaiverSendChannel,
  type WaiverSendCopy,
  type WaiverSendState,
  type WaiverSendSurface,
  waiverLinkPath,
  waiverSendStateFromOutcome,
} from "@/app/actions/waiver-send-types";
import { Copyable } from "@/components/Copyable";
import { SendHold } from "@/components/SendHold";
import { buttonClass } from "@/components/ui/button";
import { INSET_NOTE_BOX } from "@/components/ui/card";
import { StatusMark } from "@/components/ui/StatusMark";
import { fill, pluralForm } from "@/i18n/fill";
import { shopPath } from "@/lib/staff-notices";

/**
 * The diver's name and a control that puts their link on the clipboard.
 *
 * **The URL itself is never rendered.** It used to be — truncated, as a live
 * anchor, under a sentence suggesting the staffer share it — and that was three
 * mistakes at once: a bearer credential on screen at rest, a link the shop
 * could tap by accident and consume, and a paragraph telling them to do what
 * the button beside it already does. The tap is the way to the link; there is
 * no reading it off the page (docs/design/accessibility-tradeoffs.md, A11Y-02).
 */
function CopyLink({
  link,
  copy: copyText,
  autoCopy,
  resend,
  offerCounter,
}: {
  link: WaiverFallbackLink;
  copy: WaiverSendCopy;
  /** True when the staffer's tap *was* "copy the link" — see `Copyable`. */
  autoCopy?: boolean;
  /** Where a booked seat's "Send by text" posts; absent where it cannot. */
  resend?: ResendTarget;
  /** Today: a seat no text can reach links to its counter queue. */
  offerCounter?: boolean;
}) {
  const path = waiverLinkPath(link);
  // A booked seat has no link to hand over (ADR 20261105-waiver-folds-into-
  // the-thread): its name, and a text to the number on file instead, or the
  // counter when no text can reach it (issue #4039).
  if (!path) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{link.name}</span>
        {resend && link.bookingId && link.textable ? (
          <WaiverSendControl
            {...resend}
            channel="sms"
            bookingIds={[link.bookingId]}
            label={copyText.sendByText}
            wrapperClassName=""
            copy={copyText}
          />
        ) : null}
        {offerCounter && link.counter && !link.textable ? (
          <Link
            href={shopPath(
              link.counter.shopSlug,
              "trips",
              link.counter.tripId,
              "party",
              link.counter.leadBookingId,
              "waivers",
            )}
            className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline"
          >
            {copyText.signAtCounter}
          </Link>
        ) : null}
      </div>
    );
  }
  const url =
    typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{link.name}</span>
      <Copyable
        layout="inline"
        autoCopy={autoCopy}
        value={url}
        copyLabel={copyText.copyLink}
        copiedLabel={copyText.copied}
        failedLabel={copyText.copyFailed}
      />
    </div>
  );
}

/**
 * Why staff must hand the link over themselves, phrased for one diver or
 * several — and, for the two reasons whose wording names a channel, phrased for
 * the channel the tap actually used. "Email could not be delivered" about a text
 * points a shop at the wrong setting, which is the confusion `no_app_origin`
 * already exists to prevent.
 */
export function reasonCopy(
  copy: WaiverSendCopy,
  reason: WaiverFallbackLink["reason"],
  count: number,
  channel: WaiverSendChannel = "email",
): string {
  const values = { count };
  if (reason === "no_email") {
    return fill(
      pluralForm(count, { one: copy.reasonNoEmailOne, other: copy.reasonNoEmailOther }),
      values,
    );
  }
  if (reason === "no_phone") {
    return fill(
      pluralForm(count, { one: copy.reasonNoPhoneOne, other: copy.reasonNoPhoneOther }),
      values,
    );
  }
  if (reason === "failed") {
    return fill(
      channel === "sms"
        ? pluralForm(count, { one: copy.reasonTextFailedOne, other: copy.reasonTextFailedOther })
        : pluralForm(count, { one: copy.reasonFailedOne, other: copy.reasonFailedOther }),
      values,
    );
  }
  if (reason === "test_recipient") {
    return fill(
      pluralForm(count, { one: copy.reasonTestRecipientOne, other: copy.reasonTestRecipientOther }),
      values,
    );
  }
  if (reason === "no_app_origin") return copy.reasonNoAppOrigin;
  if (reason === "thread_only") return copy.reasonThreadOnly;
  if (reason === "guardian_needed") return copy.reasonGuardianNeeded;
  if (reason === "guardian_check") return copy.guardianCheck;
  return channel === "sms" ? copy.reasonTextUnconfigured : copy.reasonUnconfigured;
}

/**
 * One line per delivery reason, so "no address on file" never reads as "the
 * shop's email is broken" or the reverse — and under it, a way to take the
 * link for each diver it applies to.
 *
 * The reason stands alone. It used to be glued into "{reason} — share this
 * private link:", which spent a clause telling a staffer to do the thing the
 * control under it was already offering.
 */
function LinkGroups({
  links,
  copy,
  channel,
  autoCopy,
  resend,
  offerCounter,
}: {
  links: WaiverFallbackLink[];
  copy: WaiverSendCopy;
  /** Which button produced these — the two channel-named reasons read off it. */
  channel: WaiverSendChannel;
  autoCopy?: boolean;
  resend?: ResendTarget;
  offerCounter?: boolean;
}) {
  const groups: Record<WaiverFallbackLink["reason"], WaiverFallbackLink[]> = {
    link_only: links.filter((link) => link.reason === "link_only"),
    thread_only: links.filter((link) => link.reason === "thread_only"),
    guardian_needed: links.filter((link) => link.reason === "guardian_needed"),
    guardian_check: links.filter((link) => link.reason === "guardian_check"),
    no_email: links.filter((link) => link.reason === "no_email"),
    no_phone: links.filter((link) => link.reason === "no_phone"),
    no_app_origin: links.filter((link) => link.reason === "no_app_origin"),
    unconfigured: links.filter((link) => link.reason === "unconfigured"),
    test_recipient: links.filter((link) => link.reason === "test_recipient"),
    failed: links.filter((link) => link.reason === "failed"),
  };
  return (
    <>
      {(Object.keys(groups) as Array<WaiverFallbackLink["reason"]>).map((reason) => {
        const group = groups[reason];
        if (group.length === 0) return null;
        return (
          <div key={reason} className="mt-2">
            {/* `link_only` is the staffer's own "Copy link" tap: nothing failed,
                nothing needs explaining, and the control below says what
                happened. Every other reason is a gap they have to know about. */}
            {reason === "link_only" ? null : (
              <p className="text-muted">{reasonCopy(copy, reason, group.length, channel)}</p>
            )}
            <div className="mt-2 flex flex-col gap-1.5">
              {group.map((link) => (
                <CopyLink
                  key={link.token ?? link.bookingId ?? link.name}
                  link={link}
                  copy={copy}
                  autoCopy={autoCopy}
                  // A text that just failed is not offered again as a text.
                  resend={channel === "sms" ? undefined : resend}
                  offerCounter={offerCounter}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * What the tap did, in place. Exported because the diver record's action row
 * drives the same server action from three buttons and must report its outcome
 * the same way — one vocabulary for "sent", "already signed", "here is the
 * link", wherever staff tapped.
 */
/** Where a seat's "Send by text" posts: the same surface the first tap was on. */
type ResendTarget = { surface: WaiverSendSurface; tripId?: string; ticketId?: string };

export function ResultNotice({
  state,
  copy,
  resend,
}: {
  state: WaiverSendState;
  copy: WaiverSendCopy;
  resend?: ResendTarget;
}) {
  if (state.status !== "done") return null;
  const nothing =
    state.sent.length === 0 &&
    state.links.length === 0 &&
    state.alreadyDone.length === 0 &&
    state.errors.length === 0;
  if (nothing && !state.emptySelection) return null;

  return (
    // A note carved into the station's card, so the one inset box on the
    // sunken fill: it was a third spelling, 10px down behind a hairline the
    // sunken fill already made redundant (pixel-craft class 12).
    <div role="status" className={`mt-3 ${INSET_NOTE_BOX} bg-surface-sunken`}>
      {state.emptySelection ? (
        <p className="flex items-start gap-1.5 text-danger">
          <StatusMark variant="danger" />
          <span>{copy.emptySelection}</span>
        </p>
      ) : null}
      {state.sent.length > 0 ? (
        <p className="flex items-start gap-1.5 font-medium text-success">
          <StatusMark variant="success" />
          <span>{fill(copy.sent, { names: state.sent.join(", ") })}</span>
        </p>
      ) : null}
      {state.alreadyDone.length > 0 ? (
        <p className="mt-1 text-muted">
          {fill(state.alreadyDone.length === 1 ? copy.alreadyDoneOne : copy.alreadyDoneOther, {
            names: state.alreadyDone.join(", "),
          })}
        </p>
      ) : null}
      {state.links.length > 0 ? (
        // Only a deliberate "Copy link" writes to the clipboard. A fallback link
        // shown *because* an email bounced is information, not a copy the
        // staffer asked for, and silently overwriting their clipboard for it
        // would be a side effect nobody chose.
        <LinkGroups
          links={state.links}
          copy={copy}
          channel={state.channel}
          autoCopy={state.channel === "link"}
          resend={resend}
          // Today offers a seat no text can reach its counter queue; the
          // roster's row already links there (issue #4039).
          offerCounter={resend?.surface === "today"}
        />
      ) : null}
      {state.errors.length > 0 ? (
        <p className="mt-1 flex items-start gap-1.5 text-danger">
          <StatusMark variant="danger" />
          <span>{fill(copy.errors, { names: state.errors.join(", ") })}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The one-tap waiver send used on Today and Blockers. It posts the shared server
 * action in place and renders the outcome inline — "Waiver sent to the diver", or a
 * a way to copy the private link when there is no email — so the label never lies about
 * what the tap did and staff never leave the queue. Falls back to a plain form
 * post (the send still happens) before hydration.
 */
export function WaiverSendControl({
  surface,
  tripId,
  ticketId,
  bookingIds,
  personId,
  channel,
  label,
  hint,
  confirmMessage,
  className,
  wrapperClassName,
  copy,
}: {
  surface: WaiverSendSurface;
  /** Defaults to email; a seat's "Send by text" fallback passes `sms`. */
  channel?: WaiverSendChannel;
  /** Required when surface is "roster" — which trip's guests page to revalidate. */
  tripId?: string;
  /** The counter rental's ticket, when surface is "counter" and there is one yet. */
  ticketId?: string;
  bookingIds: string[];
  /** A person-scoped waiver target, independent of any booking or schedule. */
  personId?: string;
  label: string;
  /** Short trailing detail (e.g. "tap to resend") — the roster's status-faced send uses this. */
  hint?: string;
  pendingLabel?: string;
  /** An in-page `InlineConfirm` guard before a resend — the roster's already-sent case wants this. */
  confirmMessage?: string;
  /**
   * Overrides the default secondary-button look — the roster's per-status
   * `buttonClass`, `danger` for an expired link. The default is `sm`: its home
   * is a ledger row on Today, beside fixes that are all `sm` (`button.ts`, "a
   * ledger row … takes `sm`").
   */
  className?: string;
  /** Overrides the outer `sm:text-right` alignment — the roster's two-column grid wants it left. */
  wrapperClassName?: string;
  copy: WaiverSendCopy;
}) {
  // The tap holds the send for eight seconds and this control's row says
  // "Sending…" with Undo where the button was (ADR 20260906-before-you-ask,
  // decision 2); the outcome lands here once the hold drains, in the same shape the
  // notice below has always rendered.
  const [state, setState] = useState<WaiverSendState>(IDLE_WAIVER_SEND_STATE);
  // **The tap answered "there is nothing to send", so the button goes.**
  //
  // A row saying a diver's waiver link could not be delivered after five
  // attempts, whose fix button reports that they already have a signed waiver,
  // is offering work that cannot exist: `issueWaiverRequest` refuses this
  // person outright (`already_completed`), so every further tap returns the
  // same sentence. The queue row itself is stale until the page is re-read —
  // that is the nature of a list rendered before the tap — but a control that
  // has just been told its own errand is finished must not keep inviting it.
  //
  // Only when there is nothing else to act on: a send that partly landed, a
  // link to hand over, or an outright failure all leave a real reason to tap
  // again, and those keep the button.
  const nothingLeftToSend =
    state.status === "done" &&
    state.alreadyDone.length > 0 &&
    state.sent.length === 0 &&
    state.links.length === 0 &&
    state.errors.length === 0;
  const buttonClassName =
    className ??
    buttonClass({ variant: "secondary", size: "sm", className: "w-full shrink-0 sm:w-auto" });
  const labelContent = (
    <>
      {label}
      {hint ? (
        <>
          <span aria-hidden="true" className="opacity-40">
            ·
          </span>
          <span className="font-normal opacity-70">{hint}</span>
        </>
      ) : null}
    </>
  );

  return (
    <div className={wrapperClassName ?? "sm:text-right"}>
      {nothingLeftToSend ? null : (
        <SendHold
          className="flex sm:inline-flex"
          hold={holdSendAction}
          undo={undoHeldSendAction}
          release={releaseHeldSendAction}
          onOutcome={(outcome) => setState(waiverSendStateFromOutcome(outcome, copy.unnamedDiver))}
          copy={copy.hold}
          // The one clause a reissue keeps: the old link stops working, which
          // the row cannot show on its own.
          note={confirmMessage}
        >
          <input type="hidden" name="holdKind" value="waiver_send" />
          <input type="hidden" name="surface" value={surface} />
          {tripId ? <input type="hidden" name="tripId" value={tripId} /> : null}
          {ticketId ? <input type="hidden" name="ticketId" value={ticketId} /> : null}
          {bookingIds.map((id) => (
            <input key={id} type="hidden" name="bookingId" value={id} />
          ))}
          {personId ? <input type="hidden" name="personId" value={personId} /> : null}
          {channel ? <input type="hidden" name="channel" value={channel} /> : null}
          <button type="submit" className={buttonClassName}>
            {labelContent}
          </button>
        </SendHold>
      )}
      <ResultNotice state={state} copy={copy} resend={{ surface, tripId, ticketId }} />
    </div>
  );
}
