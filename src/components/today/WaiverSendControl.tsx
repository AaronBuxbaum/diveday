"use client";

import { useActionState, useState } from "react";
import {
  IDLE_WAIVER_SEND_STATE,
  type WaiverFallbackLink,
  type WaiverSendState,
  type WaiverSendSurface,
} from "@/app/actions/waiver-send-types";
import { sendWaiversAction } from "@/app/actions/waivers";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";

function CopyLink({ link }: { link: WaiverFallbackLink }) {
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
        <span aria-live="polite">{copied ? "Copied" : "Copy link"}</span>
      </button>
    </div>
  );
}

/** Why staff must hand the link over themselves, phrased for one diver or several. */
function reasonCopy(reason: WaiverFallbackLink["reason"], count: number): string {
  const plural = count > 1;
  if (reason === "no_email") {
    return plural ? `${count} have no email on file` : "No email on file";
  }
  if (reason === "failed") {
    return plural ? `Email could not be delivered to ${count}` : "Email could not be delivered";
  }
  if (reason === "test_recipient") {
    return plural
      ? `${count} test email addresses can’t receive mail`
      : "This test email address can’t receive mail";
  }
  return "This shop has no email provider configured yet";
}

/** One paragraph per delivery reason, so "no address on file" never reads as
 * "the shop's email is broken" or the reverse. */
function LinkGroups({ links }: { links: WaiverFallbackLink[] }) {
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
              {reasonCopy(reason, group.length)} — share{" "}
              {group.length === 1 ? "this private link" : "these private links"}:
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {group.map((link) => (
                <CopyLink key={link.token} link={link} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function ResultNotice({ state }: { state: WaiverSendState }) {
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
          Waiver sent to {state.sent.join(", ")}.
        </p>
      ) : null}
      {state.alreadyDone.length > 0 ? (
        <p className="mt-1 text-muted">
          {state.alreadyDone.join(", ")} already {state.alreadyDone.length === 1 ? "has" : "have"} a
          signed waiver — nothing reissued.
        </p>
      ) : null}
      {state.links.length > 0 ? <LinkGroups links={state.links} /> : null}
      {state.errors.length > 0 ? (
        <p className="mt-1 text-danger">
          Couldn’t send to {state.errors.join(", ")} — open the roster to check the booking.
        </p>
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
  pendingLabel = "Sending…",
  confirmMessage,
  className,
  wrapperClassName,
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
  /** A native confirm() prompt before a resend — the roster's already-sent case wants this. */
  confirmMessage?: string;
  /** Overrides the default secondary-button look — the roster's per-status tone pill. */
  className?: string;
  /** Overrides the outer `sm:text-right` alignment — the roster's two-column grid wants it left. */
  wrapperClassName?: string;
}) {
  const [state, formAction] = useActionState(
    sendWaiversAction.bind(null, shopSlug, surface, tripId),
    IDLE_WAIVER_SEND_STATE,
  );

  return (
    <div className={wrapperClassName ?? "sm:text-right"}>
      <form action={formAction} className="flex sm:inline-flex">
        {bookingIds.map((id) => (
          <input key={id} type="hidden" name="bookingId" value={id} />
        ))}
        <SubmitButton
          pendingLabel={pendingLabel}
          confirmMessage={confirmMessage}
          className={
            className ??
            buttonClass({ variant: "secondary", className: "w-full shrink-0 sm:w-auto" })
          }
        >
          {label}
          {hint ? (
            <>
              <span aria-hidden="true" className="opacity-40">
                ·
              </span>
              <span className="font-normal opacity-70">{hint}</span>
            </>
          ) : null}
        </SubmitButton>
      </form>
      <ResultNotice state={state} />
    </div>
  );
}
