"use client";

import { useActionState } from "react";
import {
  IDLE_WAIVER_SEND_STATE,
  type WaiverFallbackLink,
  type WaiverSendCopy,
  type WaiverSendState,
  type WaiverSendSurface,
} from "@/app/actions/waiver-send-types";
import { sendWaiversAction } from "@/app/actions/waivers";
import { Copyable } from "@/components/Copyable";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { InlineConfirm } from "@/components/ui/InlineConfirm";

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));
}

function CopyLink({ link, copy: copyText }: { link: WaiverFallbackLink; copy: WaiverSendCopy }) {
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
      <Copyable
        layout="inline"
        value={url || `/waivers/${link.token}`}
        copyLabel={copyText.copyLink}
        copiedLabel={copyText.copied}
        failedLabel={copyText.copyFailed}
      />
    </div>
  );
}

/** Why staff must hand the link over themselves, phrased for one diver or several. */
function reasonCopy(
  copy: WaiverSendCopy,
  reason: WaiverFallbackLink["reason"],
  count: number,
): string {
  const plural = count > 1;
  const values = { count: String(count) };
  if (reason === "no_email") {
    return plural ? fill(copy.reasonNoEmailOther, values) : copy.reasonNoEmailOne;
  }
  if (reason === "failed") {
    return plural ? fill(copy.reasonFailedOther, values) : copy.reasonFailedOne;
  }
  if (reason === "test_recipient") {
    return plural ? fill(copy.reasonTestRecipientOther, values) : copy.reasonTestRecipientOne;
  }
  return copy.reasonUnconfigured;
}

/** One paragraph per delivery reason, so "no address on file" never reads as
 * "the shop's email is broken" or the reverse. */
function LinkGroups({ links, copy }: { links: WaiverFallbackLink[]; copy: WaiverSendCopy }) {
  const groups: Record<WaiverFallbackLink["reason"], WaiverFallbackLink[]> = {
    no_email: links.filter((link) => link.reason === "no_email"),
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
              {reasonCopy(copy, reason, group.length)} — share{" "}
              {group.length === 1 ? copy.sharePrivateLinkOne : copy.sharePrivateLinkOther}:
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {group.map((link) => (
                <CopyLink key={link.token} link={link} copy={copy} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function ResultNotice({ state, copy }: { state: WaiverSendState; copy: WaiverSendCopy }) {
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
          <span aria-hidden="true">✓ </span>
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
      {state.links.length > 0 ? <LinkGroups links={state.links} copy={copy} /> : null}
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
 * what the tap did and staff never leave the queue. Degrades to a plain form
 * post (the send still happens) without JavaScript.
 */
export function WaiverSendControl({
  shopSlug,
  surface,
  tripId,
  bookingIds,
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
