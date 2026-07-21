"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  IDLE_WAIVER_SEND_STATE,
  type WaiverFallbackLink,
  type WaiverSendState,
  type WaiverSendSurface,
} from "@/app/actions/waiver-send-types";
import { sendWaiversAction } from "@/app/actions/waivers";
import { buttonClass } from "@/components/ui/button";

function SendButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClass({ variant: "secondary", className: "shrink-0" })}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

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
      {state.links.length > 0 ? (
        <div className="mt-2">
          <p className="text-muted">
            {state.links.length === 1 ? "No email on file" : `${state.links.length} have no email`}{" "}
            — share {state.links.length === 1 ? "this private link" : "these private links"}:
          </p>
          <div className="mt-2 flex flex-col gap-1.5">
            {state.links.map((link) => (
              <CopyLink key={link.token} link={link} />
            ))}
          </div>
        </div>
      ) : null}
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
  bookingIds,
  label,
  pendingLabel = "Sending…",
}: {
  shopSlug: string;
  surface: WaiverSendSurface;
  bookingIds: string[];
  label: string;
  pendingLabel?: string;
}) {
  const [state, formAction] = useActionState(
    sendWaiversAction.bind(null, shopSlug, surface),
    IDLE_WAIVER_SEND_STATE,
  );

  return (
    <div className="sm:text-right">
      <form action={formAction} className="inline-flex">
        {bookingIds.map((id) => (
          <input key={id} type="hidden" name="bookingId" value={id} />
        ))}
        <SendButton label={label} pendingLabel={pendingLabel} />
      </form>
      <ResultNotice state={state} />
    </div>
  );
}
