"use client";

import { useActionState, useEffect, useState } from "react";
import {
  holdSendAction,
  releaseHeldSendAction,
  undoHeldSendAction,
} from "@/app/actions/held-sends";
import { copyToClipboard } from "@/components/Copyable";
import { SendHold, type SendHoldCopy } from "@/components/SendHold";
import { buttonClass } from "@/components/ui/button";
import { fill } from "@/i18n/fill";
import { nowDate } from "@/lib/clock";

/** Every word this client component renders, resolved on the server — see the
 * note in src/i18n/staff-messages.ts. Templates rather than finished strings:
 * the relative time and the email draft both depend on values only known in
 * the browser (the current instant, `window.location.origin`). */
export type WaitlistInviteCopy = {
  /** The held send's countdown row (ADR 20260906-before-you-ask, decision 2). */
  hold: SendHoldCopy;
  invitedRelative: string;
  inviteEmailed: string;
  reSendInvite: string;
  emailAnInvite: string;
  copied: string;
  copyInviteMessage: string;
  copyFailed: string;
  justNow: string;
  minutesAgo: string;
  hoursAgo: string;
  daysAgo: string;
  emailSubject: string;
  emailBody: string;
};

function relativeTime(copy: WaitlistInviteCopy, from: Date, now = nowDate()): string {
  const mins = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60000));
  if (mins < 1) return copy.justNow;
  if (mins < 60) return fill(copy.minutesAgo, { mins: String(mins) });
  const hours = Math.round(mins / 60);
  if (hours < 24) return fill(copy.hoursAgo, { hours: String(hours) });
  const days = Math.round(hours / 24);
  return fill(copy.daysAgo, { days: String(days) });
}

/** What `invite` reported, plus the not-yet-submitted state a fresh mount
 * starts in — carried by `useActionState` between the form submit and the
 * effect that acts on the result. */
type InviteOutcome = "idle" | "sent" | "fallback";

/**
 * One-tap seat recovery: sends a wait-list diver the freed-seat invite through
 * the server notification seam (real email, by default) and records that it
 * happened so two staff don't both reach out. Only when the server reports it
 * could not send — no provider configured, or no address on file — does the
 * control fall back to a copyable/mailto composer with the same booking link,
 * so an invite always goes out one way or another.
 */
export function WaitlistInvite({
  entryId,
  personName,
  personEmail,
  invitedAt,
  bookingPath,
  shopName,
  tripTitle,
  tripWhen,
  tripId,
  invite,
  copy,
}: {
  entryId: string;
  personName: string;
  personEmail: string | null;
  invitedAt: Date | string | null;
  bookingPath: string;
  shopName: string;
  tripTitle: string;
  tripWhen: string;
  /** The departure the seat is on: the held send is keyed to it. Absent on the record-only path. */
  tripId?: string;
  /**
   * A request-origin invitation is recorded rather than sent — the server
   * notes the outreach and hands staff the composer — so it takes this
   * immediate path and never the hold. Absent for a wait-list seat.
   */
  invite?: (entryId: string) => Promise<"sent" | "fallback">;
  copy: WaitlistInviteCopy;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [emailed, setEmailed] = useState(false);
  const invited = invitedAt ? new Date(invitedAt) : null;
  const firstName = personName.split(" ")[0] || personName;

  const bookingUrl =
    typeof window === "undefined"
      ? bookingPath
      : new URL(bookingPath, window.location.origin).toString();
  const subject = fill(copy.emailSubject, { tripTitle });
  const body = fill(copy.emailBody, { firstName, tripTitle, tripWhen, shopName, bookingUrl });
  const mailto = personEmail
    ? `mailto:${encodeURIComponent(personEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null;

  async function copyMessage() {
    const ok = await copyToClipboard(`${subject}\n\n${body}`);
    setCopyStatus(ok ? "copied" : "failed");
    setTimeout(() => setCopyStatus("idle"), 4000);
  }

  // Bumped on every outcome, so a repeat of the same one (two "fallback"s in
  // a row) still re-runs the effect below instead of going quiet because the
  // state value didn't change — same purpose as the `attempt` counter in
  // WaiverDeliveryActions.
  const [attempt, setAttempt] = useState(0);
  // The tap holds the invite for eight seconds and the row counts it down with
  // Undo where the button was (ADR 20260906-before-you-ask, decision 2). The
  // outcome lands here once the hold drains; the effect below does the same
  // post-send work the old submit did with it: open the mailto composer, or
  // copy the message, only when the server couldn't send.
  const [result, setResult] = useState<InviteOutcome>("idle");
  const [recorded, recordAction, recording] = useActionState<InviteOutcome>(async () => {
    if (!invite) return "idle";
    const outcome = await invite(entryId);
    setAttempt((count) => count + 1);
    return outcome;
  }, "idle");
  useEffect(() => {
    if (recorded !== "idle") setResult(recorded);
  }, [recorded]);

  // Reacts to result/attempt only — mailto and copyMessage are derived fresh
  // from props every render, not values worth resubscribing to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    if (attempt === 0) return;
    if (result === "sent") {
      setEmailed(true);
      const timer = setTimeout(() => setEmailed(false), 4000);
      return () => clearTimeout(timer);
    }
    if (result === "fallback") {
      // Email present: the server couldn't send, so open the local composer.
      // No address on file: hand staff the copyable message instead.
      if (mailto) {
        window.location.href = mailto;
      } else {
        void copyMessage();
      }
    }
  }, [result, attempt]);

  return (
    <div className="flex flex-col items-end gap-1">
      {invite ? (
        <form action={recordAction} className="contents">
          {personEmail ? (
            <button
              type="submit"
              disabled={recording}
              className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}
            >
              <span aria-live="polite">
                {emailed
                  ? copy.inviteEmailed
                  : invited
                    ? copy.reSendInvite
                    : fill(copy.emailAnInvite, { firstName })}
              </span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={recording}
              className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}
            >
              <span aria-live="polite">
                {copyStatus === "copied"
                  ? copy.copied
                  : copyStatus === "failed"
                    ? copy.copyFailed
                    : copy.copyInviteMessage}
              </span>
            </button>
          )}
        </form>
      ) : (
        <SendHold
          className="contents"
          hold={holdSendAction}
          undo={undoHeldSendAction}
          release={releaseHeldSendAction}
          onOutcome={(outcome) => {
            setResult(outcome.kind === "waitlist_invite" ? outcome.result : "fallback");
            setAttempt((count) => count + 1);
          }}
          copy={copy.hold}
        >
          <input type="hidden" name="holdKind" value="waitlist_invite" />
          {tripId ? <input type="hidden" name="tripId" value={tripId} /> : null}
          <input type="hidden" name="entryId" value={entryId} />
          {personEmail ? (
            <button
              type="submit"
              className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}
            >
              <span aria-live="polite">
                {emailed
                  ? copy.inviteEmailed
                  : invited
                    ? copy.reSendInvite
                    : fill(copy.emailAnInvite, { firstName })}
              </span>
            </button>
          ) : (
            <button
              type="submit"
              className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}
            >
              <span aria-live="polite">
                {copyStatus === "copied"
                  ? copy.copied
                  : copyStatus === "failed"
                    ? copy.copyFailed
                    : copy.copyInviteMessage}
              </span>
            </button>
          )}
        </SendHold>
      )}
      {invited ? (
        <span className="text-xs text-muted">
          {fill(copy.invitedRelative, { time: relativeTime(copy, invited) })}
        </span>
      ) : null}
    </div>
  );
}
