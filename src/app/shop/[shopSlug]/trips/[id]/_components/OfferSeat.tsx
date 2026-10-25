"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import {
  holdSendAction,
  releaseHeldSendAction,
  undoHeldSendAction,
} from "@/app/actions/held-sends";
import { copyToClipboard } from "@/components/Copyable";
import { SendHold, type SendHoldCopy } from "@/components/SendHold";
import { buttonClass, proseLinkClass } from "@/components/ui/button";
import type { HeldSendOutcome } from "@/db/held-sends";
import { fill } from "@/i18n/fill";
import { useOfferDiscountBlank } from "./OfferDiscount";

/** Every word this client component renders, resolved on the server (`offerSeatCopy`). */
export type OfferSeatCopy = {
  /** The held send's undo row (ADR 20260906-before-you-ask, decision 2). */
  hold: SendHoldCopy;
  offerSeat: string;
  sent: string;
  couldntSend: string;
  /** "Write to {name}" */
  writeTo: string;
  /** "Copy message for {name}" */
  copyFor: string;
  copied: string;
  copyFailed: string;
  emailSubject: string;
  emailBody: string;
};

/** The interests an offer may reach, with what the composer fallback needs of each. */
export type OfferSeatInterest = { interestId: string; name: string; email: string | null };

type Fallback = { interest: OfferSeatInterest; mailto: string | null; message: string };

/**
 * **Offer a seat** (ADR 20261017-one-interest-with-a-scope): the one act on who
 * wants in, always a held send (`seat_offer`, eight seconds, Undo where the
 * button stood), to the `interests` it is given: one row's person, on Who
 * wants in and on Today's row alike. The tick boxes and the bulk "Offer a
 * seat to N" went (visual review 2026-10-24, A14): two ways to offer on one
 * list, and a disabled button that waited for a tick.
 *
 * Only an interest the server could not email (no provider, no address, an opt-out
 * or a send inside the 24-hour window) falls back to a composer with the same
 * booking link, so an offer always goes out one way or another: a single
 * fallback opens the mail client (or copies the message when there is no
 * address), several are listed, one line each.
 */
export function OfferSeat({
  formId,
  tripId,
  interests,
  label,
  ariaLabel,
  offeredLabel,
  bookingPath,
  shopName,
  tripTitle,
  tripWhen,
  copy,
  discountFields = null,
}: {
  /** Unique on the page: the tick boxes name it. */
  formId: string;
  tripId: string;
  interests: OfferSeatInterest[];
  /** The button's words: "Offer a seat", or the Today row's "Offer a seat to Ana". */
  label?: string;
  /** The button's name for a reader when its words repeat down a list: "Offer Ana a seat". */
  ariaLabel?: string;
  /** "offered 2h ago", when the interest was already offered this seat. */
  offeredLabel?: string;
  bookingPath: string;
  shopName: string;
  tripTitle: string;
  tripWhen: string;
  copy: OfferSeatCopy;
  /** The discount's rider (`OfferDiscountRider`), for a role that may discount. */
  discountFields?: ReactNode;
}) {
  const router = useRouter();
  const [emailed, setEmailed] = useState(false);
  const [fallbacks, setFallbacks] = useState<Fallback[]>([]);
  const [copied, setCopied] = useState<Record<string, "copied" | "failed">>({});

  const count = interests.length;

  function composerFor(interest: OfferSeatInterest): Fallback {
    const bookingUrl = new URL(bookingPath, window.location.origin).toString();
    const firstName = interest.name.split(" ")[0] || interest.name;
    const subject = fill(copy.emailSubject, { tripTitle });
    const body = fill(copy.emailBody, { firstName, tripTitle, tripWhen, shopName, bookingUrl });
    return {
      interest,
      message: `${subject}\n\n${body}`,
      mailto: interest.email
        ? `mailto:${encodeURIComponent(interest.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
        : null,
    };
  }

  async function copyMessage(fallback: Fallback) {
    const ok = await copyToClipboard(fallback.message);
    setCopied((now) => ({ ...now, [fallback.interest.interestId]: ok ? "copied" : "failed" }));
    setTimeout(
      () =>
        setCopied((now) => {
          const { [fallback.interest.interestId]: _gone, ...rest } = now;
          return rest;
        }),
      4000,
    );
  }

  function onOutcome(outcome: HeldSendOutcome & { redirectTo?: string }) {
    const results = outcome.kind === "seat_offer" ? outcome.results : [];
    const failed = results
      .filter((result) => result.delivery !== "sent")
      .flatMap((result) =>
        interests.filter((interest) => interest.interestId === result.interestId),
      );
    const next = failed.map(composerFor);
    setFallbacks(next);
    if (failed.length < results.length) {
      setEmailed(true);
      setTimeout(() => setEmailed(false), 4000);
    }
    // A deal's outcome carries the notice the shop answers it with (sent, or
    // why not), on the Details history; follow it unless a composer is open.
    if (outcome.redirectTo && next.length === 0) router.push(outcome.redirectTo);
    const only = next.length === 1 ? next[0] : undefined;
    if (only?.mailto) window.location.href = only.mailto;
    else if (only) void copyMessage(only);
  }

  const discountBlank = useOfferDiscountBlank();
  const buttonText = emailed ? copy.sent : (label ?? copy.offerSeat);

  return (
    <div className="flex flex-col items-start gap-1">
      <SendHold
        className="contents"
        formId={formId}
        hold={holdSendAction}
        undo={undoHeldSendAction}
        release={releaseHeldSendAction}
        onOutcome={onOutcome}
        copy={copy.hold}
      >
        <input type="hidden" name="holdKind" value="seat_offer" />
        <input type="hidden" name="tripId" value={tripId} />
        {interests.map((interest) => (
          <input
            key={interest.interestId}
            type="hidden"
            name="interestId"
            value={interest.interestId}
          />
        ))}
        {discountFields}
        <button
          type="submit"
          disabled={count === 0 || discountBlank}
          aria-label={emailed ? undefined : ariaLabel}
          className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}
        >
          <span aria-live="polite">{buttonText}</span>
        </button>
      </SendHold>
      {offeredLabel ? <span className="text-xs text-muted">{offeredLabel}</span> : null}
      {fallbacks.length > 0 ? (
        <div className="text-xs text-muted">
          <p>{copy.couldntSend}</p>
          <ul className="mt-1 space-y-1">
            {fallbacks.map((fallback) => (
              <li key={fallback.interest.interestId}>
                {fallback.mailto ? (
                  <a href={fallback.mailto} className={proseLinkClass}>
                    {fill(copy.writeTo, { name: fallback.interest.name })}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => void copyMessage(fallback)}
                    className={proseLinkClass}
                  >
                    {copied[fallback.interest.interestId] === "copied"
                      ? copy.copied
                      : copied[fallback.interest.interestId] === "failed"
                        ? copy.copyFailed
                        : fill(copy.copyFor, { name: fallback.interest.name })}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
