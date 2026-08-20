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
import { fill, pluralForm } from "@/i18n/fill";

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
      ? ""
      : new URL(`/waivers/${link.token}`, window.location.origin).toString();

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{link.name}:</span>
      <a
        href={`/waivers/${link.token}`}
        className="max-w-[16rem] truncate font-medium text-primary hover:underline"
      >
        /waivers/{link.token.slice(0, 8)}…
      </a>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true">🔗</span>
        <Copyable
          layout="inline"
          autoCopy={autoCopy}
          value={url || `/waivers/${link.token}`}
          copyLabel={copyText.copyLink}
          copiedLabel={copyText.copied}
          failedLabel={copyText.copyFailed}
        />
      </span>
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
  if (reason === "link_only") {
    return fill(
      pluralForm(count, { one: copy.reasonLinkOnlyOne, other: copy.reasonLinkOnlyOther }),
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

/** One paragraph per delivery reason, so "no address on file" never reads as
 * "the shop's email is broken" or the reverse. */
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
    sent: links.filter((link) => link.reason === "sent"),
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
            <p className="text-muted">
              {fill(group.length === 1 ? copy.sharePrivateLinkOne : copy.sharePrivateLinkOther, {
                reason:
                  reason === "sent"
                    ? fill(copy.sent, { names: group.map((link) => link.name).join(", ") })
                    : reasonCopy(copy, reason, group.length, channel),
              })}
            </p>
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
      {state.emptySelection ? <p className="text-danger">{copy.emptySelection}</p> : null}
      {state.sent.length > 0 ? (
        <p className="font-medium text-success">
          <span aria-hidden="true">✅ </span>
          {fill(copy.sent, { names: state.sent.join(", ") })}
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
        <p className="mt-1 text-danger">{fill(copy.errors, { names: state.errors.join(", ") })}</p>
      ) : null}
    </div>
  );
}

/**
 * The one-tap waiver send used on Today and Blockers. It posts the shared server
 * action in place and renders the outcome inline — "Waiver sent to Diego", or a
 * copyable private link when there is no email — so the label never lies about
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
  exposeLink = false,
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
  /** Show freshly issued private links even when email delivery succeeded. */
  exposeLink?: boolean;
  copy: WaiverSendCopy;
}) {
  const [state, formAction] = useActionState(
    sendWaiversAction.bind(null, shopSlug, surface, tripId),
    IDLE_WAIVER_SEND_STATE,
  );
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
      <form action={formAction} className="flex sm:inline-flex">
        {bookingIds.map((id) => (
          <input key={id} type="hidden" name="bookingId" value={id} />
        ))}
        {personId ? <input type="hidden" name="personId" value={personId} /> : null}
        {exposeLink ? <input type="hidden" name="exposeLink" value="true" /> : null}
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
      <ResultNotice state={state} copy={copy} />
    </div>
  );
}
