"use client";

import { useEffect, useState } from "react";
import {
  holdSendAction,
  releaseHeldSendAction,
  undoHeldSendAction,
} from "@/app/actions/held-sends";
import { copyToClipboard } from "@/components/Copyable";
import { SendHold, type SendHoldCopy } from "@/components/SendHold";
import { buttonClass } from "@/components/ui/button";
import type { HeldSendOutcome } from "@/db/held-sends";
import { fill } from "@/i18n/fill";

/** Every word this client component renders, resolved on the server (`offerSeatCopy`). */
export type OfferSeatCopy = {
  /** The held send's undo row (ADR 20260906-before-you-ask, decision 2). */
  hold: SendHoldCopy;
  offerSeat: string;
  /** "Offer a seat to {count}" */
  offerSeatTo: string;
  /** "{count} ticked is below this trip’s bar" */
  belowBarOne: string;
  belowBarMany: string;
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

/** The leads an offer may reach, with what the composer fallback needs of each. */
export type OfferSeatLead = { leadId: string; name: string; email: string | null };

type Fallback = { lead: OfferSeatLead; mailto: string | null; message: string };

/** The ticks this form owns: boxes that name it in their `form` attribute. */
function tickedBoxes(formId: string): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${formId}"]:checked`),
  );
}

/**
 * **Offer a seat** (ADR 20261017-one-lead-with-a-scope): the one act on who
 * wants in, always a held send (`seat_offer`, eight seconds, Undo where the
 * button stood). Two ways to choose who:
 *
 * - `chooseByTick`: the panel's tick boxes sit outside this form and join it by
 *   their `form` attribute, so the list stays on screen while the hold drains.
 *   The label counts what is ticked, and a below-the-bar tick is said under it.
 * - otherwise (Today's row) the offer goes to `leads` as given.
 *
 * Only a lead the server could not email (no provider, no address, an opt-out
 * or a send inside the 24-hour window) falls back to a composer with the same
 * booking link, so an offer always goes out one way or another: a single
 * fallback opens the mail client (or copies the message when there is no
 * address), several are listed, one line each.
 */
export function OfferSeat({
  formId,
  tripId,
  leads,
  chooseByTick,
  label,
  offeredLabel,
  bookingPath,
  shopName,
  tripTitle,
  tripWhen,
  copy,
}: {
  /** Unique on the page: the tick boxes name it. */
  formId: string;
  tripId: string;
  leads: OfferSeatLead[];
  chooseByTick: boolean;
  /** The button's words when nothing is ticked for; the Today row's "Offer a seat to Ana". */
  label?: string;
  /** "offered 2h ago", when the lead was already offered this seat. */
  offeredLabel?: string;
  bookingPath: string;
  shopName: string;
  tripTitle: string;
  tripWhen: string;
  copy: OfferSeatCopy;
}) {
  const [ticked, setTicked] = useState({ count: 0, below: 0 });
  const [emailed, setEmailed] = useState(false);
  const [fallbacks, setFallbacks] = useState<Fallback[]>([]);
  const [copied, setCopied] = useState<Record<string, "copied" | "failed">>({});

  // The ticks live outside this component, in the server-rendered rows; one
  // listener on the document reads them whenever any box changes.
  useEffect(() => {
    if (!chooseByTick) return;
    const read = () => {
      const boxes = tickedBoxes(formId);
      setTicked({ count: boxes.length, below: boxes.filter((box) => box.dataset.belowBar).length });
    };
    read();
    document.addEventListener("change", read);
    return () => document.removeEventListener("change", read);
  }, [chooseByTick, formId]);

  const count = chooseByTick ? ticked.count : leads.length;

  function composerFor(lead: OfferSeatLead): Fallback {
    const bookingUrl = new URL(bookingPath, window.location.origin).toString();
    const firstName = lead.name.split(" ")[0] || lead.name;
    const subject = fill(copy.emailSubject, { tripTitle });
    const body = fill(copy.emailBody, { firstName, tripTitle, tripWhen, shopName, bookingUrl });
    return {
      lead,
      message: `${subject}\n\n${body}`,
      mailto: lead.email
        ? `mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
        : null,
    };
  }

  async function copyMessage(fallback: Fallback) {
    const ok = await copyToClipboard(fallback.message);
    setCopied((now) => ({ ...now, [fallback.lead.leadId]: ok ? "copied" : "failed" }));
    setTimeout(
      () =>
        setCopied((now) => {
          const { [fallback.lead.leadId]: _gone, ...rest } = now;
          return rest;
        }),
      4000,
    );
  }

  function onOutcome(outcome: HeldSendOutcome) {
    const results = outcome.kind === "seat_offer" ? outcome.results : [];
    const failed = results
      .filter((result) => result.delivery !== "sent")
      .flatMap((result) => leads.filter((lead) => lead.leadId === result.leadId));
    // A lead that went is done being ticked; one that did not stays ticked.
    for (const box of tickedBoxes(formId)) {
      if (!failed.some((lead) => lead.leadId === box.value)) box.checked = false;
    }
    const boxes = tickedBoxes(formId);
    setTicked({ count: boxes.length, below: boxes.filter((box) => box.dataset.belowBar).length });
    const next = failed.map(composerFor);
    setFallbacks(next);
    if (failed.length < results.length) {
      setEmailed(true);
      setTimeout(() => setEmailed(false), 4000);
    }
    const only = next.length === 1 ? next[0] : undefined;
    if (only?.mailto) window.location.href = only.mailto;
    else if (only) void copyMessage(only);
  }

  const buttonText = emailed
    ? copy.sent
    : chooseByTick
      ? count > 0
        ? fill(copy.offerSeatTo, { count })
        : copy.offerSeat
      : (label ?? copy.offerSeat);

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
        {chooseByTick
          ? null
          : leads.map((lead) => (
              <input key={lead.leadId} type="hidden" name="leadId" value={lead.leadId} />
            ))}
        <button
          type="submit"
          disabled={count === 0}
          className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}
        >
          <span aria-live="polite">{buttonText}</span>
        </button>
      </SendHold>
      {chooseByTick && ticked.below > 0 ? (
        <p className="text-xs text-warning-strong">
          {fill(ticked.below === 1 ? copy.belowBarOne : copy.belowBarMany, { count: ticked.below })}
        </p>
      ) : null}
      {offeredLabel ? <span className="text-xs text-muted">{offeredLabel}</span> : null}
      {fallbacks.length > 0 ? (
        <div className="text-xs text-muted">
          <p>{copy.couldntSend}</p>
          <ul className="mt-1 space-y-1">
            {fallbacks.map((fallback) => (
              <li key={fallback.lead.leadId}>
                {fallback.mailto ? (
                  <a href={fallback.mailto} className="underline">
                    {fill(copy.writeTo, { name: fallback.lead.name })}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => void copyMessage(fallback)}
                    className="underline"
                  >
                    {copied[fallback.lead.leadId] === "copied"
                      ? copy.copied
                      : copied[fallback.lead.leadId] === "failed"
                        ? copy.copyFailed
                        : fill(copy.copyFor, { name: fallback.lead.name })}
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
