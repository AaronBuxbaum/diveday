"use client";

import { useActionState, useEffect, useState } from "react";
import { copyToClipboard } from "@/components/Copyable";
import { buttonClass } from "@/components/ui/button";
import { fill } from "@/i18n/fill";
import { nowDate } from "@/lib/clock";

/** Every word this client component renders, resolved on the server — see the
 * note in src/i18n/staff-messages.ts. Templates rather than finished strings:
 * the relative time and the email draft both depend on values only known in
 * the browser (the current instant, `window.location.origin`). */
export type WaitlistInviteCopy = {
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
  invite: (entryId: string) => Promise<"sent" | "fallback">;
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

  // Bumped inside the action on every submit, so a repeat of the same outcome
  // (two "fallback"s in a row) still re-runs the effect below instead of
  // going quiet because the state value didn't change — same purpose as the
  // `attempt` counter in WaiverDeliveryActions, just driven by one action
  // instead of a per-channel tap.
  const [attempt, setAttempt] = useState(0);

  // A real <form> submit — not an onClick calling the action directly — is
  // what lets PreserveFormScroll see this and hold the page's scroll position
  // through the revalidation-driven re-render (same shape as
  // WaiverDeliveryActions). `invite`'s result rides in `result` instead of a
  // closure variable; the effect below does the same post-send work the old
  // onClick handlers did with it: open the mailto composer, or copy the
  // message, only when the server couldn't send.
  const [result, formAction, pending] = useActionState<InviteOutcome>(async () => {
    setAttempt((count) => count + 1);
    return invite(entryId);
  }, "idle");

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
      <form action={formAction} className="contents">
        {personEmail ? (
          <button
            type="submit"
            disabled={pending}
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
            disabled={pending}
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
      {invited ? (
        <span className="text-xs text-muted">
          {fill(copy.invitedRelative, { time: relativeTime(copy, invited) })}
        </span>
      ) : null}
    </div>
  );
}
