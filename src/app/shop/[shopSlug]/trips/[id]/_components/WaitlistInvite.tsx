"use client";

import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";

function relativeTime(from: Date, now = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
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
}) {
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [emailed, setEmailed] = useState(false);
  const invited = invitedAt ? new Date(invitedAt) : null;
  const firstName = personName.split(" ")[0] || personName;

  const bookingUrl =
    typeof window === "undefined"
      ? bookingPath
      : new URL(bookingPath, window.location.origin).toString();
  const subject = `A spot opened up on ${tripTitle}`;
  const body = `Hi ${firstName},\n\nA seat just opened on ${tripTitle} (${tripWhen}) with ${shopName}. You're next on the wait list — grab it here before it goes:\n${bookingUrl}\n\nSee you on the boat!`;
  const mailto = personEmail
    ? `mailto:${encodeURIComponent(personEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null;

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    } catch {
      setCopied(false);
    }
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
              ? "Invite emailed"
              : invited
                ? "Re-send invite"
                : `Email ${firstName} an invite`}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={copyInvite}
          disabled={pending}
          className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}
        >
          <span aria-live="polite">{copied ? "Copied" : "Copy invite message"}</span>
        </button>
      )}
      {invited ? <span className="text-xs text-muted">Invited {relativeTime(invited)}</span> : null}
    </div>
  );
}
