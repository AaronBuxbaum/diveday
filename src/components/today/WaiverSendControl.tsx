"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  IDLE_WAIVER_SEND_STATE,
  type WaiverFallbackLink,
  type WaiverSendCopy,
  type WaiverSendState,
  type WaiverSendSurface,
} from "@/app/actions/waiver-send-types";
import { sendWaiversAction } from "@/app/actions/waivers";
import { buttonClass } from "@/components/ui/button";

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));
}

function SendButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClass({ variant: "secondary", className: "w-full shrink-0 sm:w-auto" })}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function CopyLink({ link, copy: copyText }: { link: WaiverFallbackLink; copy: WaiverSendCopy }) {
  const [copied, setCopied] = useState(false);
  const url =
    typeof window === "undefined"
      ? ""
      : new URL(`/waivers/${link.token}`, window.location.origin).toString();

  async function copy() {
    try {
      await navigator.clipboard.writeText(url || `/waivers/${link.token}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{link.name}:</span>
      <a
        href={`/waivers/${link.token}`}
        className="max-w-[16rem] truncate font-medium text-primary hover:underline"
      >
        /waivers/{link.token.slice(0, 8)}…
      </a>
      <button
        type="button"
        onClick={copy}
        className={buttonClass({ variant: "ghost", size: "sm", className: "text-foreground" })}
      >
        <span aria-live="polite">{copied ? copyText.copied : copyText.copyLink}</span>
      </button>
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
  if (nothing) return null;

  return (
    <div
      role="status"
      className="mt-3 rounded-xl border border-border bg-surface-sunken px-3 py-2.5 text-sm"
    >
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
  bookingIds,
  label,
  pendingLabel,
  copy,
}: {
  shopSlug: string;
  surface: WaiverSendSurface;
  bookingIds: string[];
  label: string;
  pendingLabel?: string;
  copy: WaiverSendCopy;
}) {
  const [state, formAction] = useActionState(
    sendWaiversAction.bind(null, shopSlug, surface),
    IDLE_WAIVER_SEND_STATE,
  );

  return (
    <div className="sm:text-right">
      <form action={formAction} className="flex sm:inline-flex">
        {bookingIds.map((id) => (
          <input key={id} type="hidden" name="bookingId" value={id} />
        ))}
        <SendButton label={label} pendingLabel={pendingLabel ?? copy.sending} />
      </form>
      <ResultNotice state={state} copy={copy} />
    </div>
  );
}
