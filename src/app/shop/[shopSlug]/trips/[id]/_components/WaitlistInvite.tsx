"use client";

import { useState, useTransition } from "react";
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
  const [pending, startTransition] = useTransition();
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

  // Email present: try the real server send first; only open the local composer
  // when the server says it could not send.
  function emailInvite() {
    startTransition(async () => {
      const result = await invite(entryId);
      if (result === "sent") {
        setEmailed(true);
        setTimeout(() => setEmailed(false), 4000);
        return;
      }
      if (mailto) window.location.href = mailto;
    });
  }

  // No address on file: record the invite and hand staff the copyable message.
  function copyInvite() {
    startTransition(async () => {
      await invite(entryId);
      await copyMessage();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {personEmail ? (
        <button
          type="button"
          onClick={emailInvite}
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
          type="button"
          onClick={copyInvite}
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
      {invited ? (
        <span className="text-xs text-muted">
          {fill(copy.invitedRelative, { time: relativeTime(copy, invited) })}
        </span>
      ) : null}
    </div>
  );
}
