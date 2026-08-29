"use client";

import { useActionState } from "react";
import {
  IDLE_WAIVER_SEND_STATE,
  type WaiverFallbackLink,
  type WaiverSendChannel,
  type WaiverSendCopy,
  type WaiverSendState,
  type WaiverSendSurface,
} from "@/app/actions/waiver-send-types";
import { sendWaiversAction } from "@/app/actions/waivers";
import { Copyable } from "@/components/Copyable";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { StatusMark } from "@/components/ui/StatusMark";
import { fill, pluralForm } from "@/i18n/fill";

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
}: {
  link: WaiverFallbackLink;
  copy: WaiverSendCopy;
  /** True when the staffer's tap *was* "copy the link" — see `Copyable`. */
  autoCopy?: boolean;
}) {
  const url =
    typeof window === "undefined"
      ? `/waivers/${link.token}`
      : new URL(`/waivers/${link.token}`, window.location.origin).toString();

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
      channel === "text"
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
  return channel === "text" ? copy.reasonTextUnconfigured : copy.reasonUnconfigured;
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
}: {
  links: WaiverFallbackLink[];
  copy: WaiverSendCopy;
  /** Which button produced these — the two channel-named reasons read off it. */
  channel: WaiverSendChannel;
  autoCopy?: boolean;
}) {
  const groups: Record<WaiverFallbackLink["reason"], WaiverFallbackLink[]> = {
    link_only: links.filter((link) => link.reason === "link_only"),
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
                <CopyLink key={link.token} link={link} copy={copy} autoCopy={autoCopy} />
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
export function ResultNotice({ state, copy }: { state: WaiverSendState; copy: WaiverSendCopy }) {
  if (state.status !== "done") return null;
  const nothing =
    state.sent.length === 0 &&
    state.links.length === 0 &&
    state.alreadyDone.length === 0 &&
    state.errors.length === 0;
  if (nothing && !state.emptySelection) return null;

  return (
    <div
      role="status"
      className="mt-3 rounded-xl border border-border bg-surface-sunken px-3 py-2.5 text-sm"
    >
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
  shopSlug,
  surface,
  tripId,
  bookingIds,
  personId,
  label,
  hint,
  pendingLabel,
  confirmMessage,
  className,
  wrapperClassName,
  copy,
}: {
  shopSlug: string;
  surface: WaiverSendSurface;
  /** Required when surface is "roster" — which trip's guests page to revalidate. */
  tripId?: string;
  bookingIds: string[];
  /** A person-scoped waiver target, independent of any booking or schedule. */
  personId?: string;
  label: string;
  /** Short trailing detail (e.g. "tap to resend") — the roster's richer status pill uses this. */
  hint?: string;
  pendingLabel?: string;
  /** An in-page `InlineConfirm` guard before a resend — the roster's already-sent case wants this. */
  confirmMessage?: string;
  /** Overrides the default secondary-button look — the roster's per-status tone pill. */
  className?: string;
  /** Overrides the outer `sm:text-right` alignment — the roster's two-column grid wants it left. */
  wrapperClassName?: string;
  copy: WaiverSendCopy;
}) {
  const [state, formAction] = useActionState(
    sendWaiversAction.bind(null, shopSlug, surface, tripId),
    IDLE_WAIVER_SEND_STATE,
  );
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
    className ?? buttonClass({ variant: "secondary", className: "w-full shrink-0 sm:w-auto" });
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
        <form action={formAction} className="flex sm:inline-flex">
          {bookingIds.map((id) => (
            <input key={id} type="hidden" name="bookingId" value={id} />
          ))}
          {personId ? <input type="hidden" name="personId" value={personId} /> : null}
          {/* Resending is a send, not a reversible edit (principle 7,
              docs/design/principles.md) — a resend to someone who already got
              one guards with a real confirm, not an undo. */}
          {confirmMessage ? (
            <InlineConfirm
              triggerLabel={labelContent}
              triggerClassName={buttonClassName}
              message={confirmMessage}
              confirmLabel={copy.confirmResend}
              cancelLabel={copy.neverMind}
              pendingLabel={pendingLabel ?? copy.sending}
            />
          ) : (
            <SubmitButton pendingLabel={pendingLabel ?? copy.sending} className={buttonClassName}>
              {labelContent}
            </SubmitButton>
          )}
        </form>
      )}
      <ResultNotice state={state} copy={copy} />
    </div>
  );
}
