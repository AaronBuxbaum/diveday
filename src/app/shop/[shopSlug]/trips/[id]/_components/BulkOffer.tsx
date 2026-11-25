// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { fill } from "@/i18n/fill";
import { cachedListFormat } from "@/lib/intl-cache";
import {
  OfferSeat,
  type OfferSeatCopy,
  type OfferSeatInterest,
  type OfferSeatResult,
} from "./OfferSeat";

/** One batch of "Offer seats": who it writes to, in the words that name them. */
export type BulkOfferBatch = {
  interests: OfferSeatInterest[];
  /** "Email an offer to Ravi Menon, Hana Kobayashi, and Naledi Khumalo." */
  names: string;
  /** "Send 3 offers" */
  send: string;
  /** "Offer the next 3", drawn once this batch is spent and another waits. */
  next: string;
};

/** What the panel says once the send has answered; templates, filled in the browser. */
export type BulkOfferResultCopy = {
  /** "{sent} of {total} sent." */
  sent: string;
  /** "Already emailed in the last 24 hours: {names}." */
  alreadyEmailed: string;
};

const idsOf = (batch: BulkOfferBatch) => batch.interests.map((each) => each.interestId).join(",");

/**
 * **The page's "Offer seats", opened in one step.** The primary beside the
 * sentence links to this panel's anchor; the panel is closed until that link
 * is followed (or the page lands on the anchor), so the card carries no
 * second toggle. Opened in the click's capture phase, before the router
 * scrolls, like `AutoOpenDetails`.
 */
export function OfferSeatsReveal({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const reveal = (hash: string) => {
      if (hash !== `#${id}`) return;
      if (ref.current) ref.current.hidden = false;
      setOpen(true);
    };
    const sync = () => reveal(window.location.hash);
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const to = new URL(link.href);
      if (to.origin === window.location.origin && to.pathname === window.location.pathname)
        reveal(to.hash);
    };
    sync();
    window.addEventListener("hashchange", sync);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("hashchange", sync);
      document.removeEventListener("click", onClick, true);
    };
  }, [id]);
  return (
    <>
      {/* The landing target stands while the panel is closed, so the scroll has somewhere to go. */}
      <div id={id} className="scroll-mt-24" />
      <div ref={ref} hidden={!open} data-offer-seats-panel="">
        {children}
      </div>
    </>
  );
}

/**
 * **Offer seats, confirmed**: the sentence naming everyone one press writes
 * to, and the press. It is `OfferSeat`'s own held `seat_offer` send with
 * several interests, so the role gate, the hold with Undo, and every rule
 * about who may be emailed are that path's, unchanged.
 *
 * **The names never change under the button.** The page re-renders when the
 * send lands and the next people in line become the candidates; this keeps
 * the batch it was opened with until the staffer asks for the next one, so
 * the sentence read is the batch sent. A spent batch cannot be sent again.
 *
 * **It reports what was sent, not what was asked.** The server holds its own
 * rules when the send fires (a seat taken meanwhile, an ask out of reach, the
 * 24-hour window), so the panel then says how many of the named people were
 * emailed, and names whoever was skipped for the window. Anyone else not
 * reached is listed by `OfferSeat` with a way to write to them. The result
 * stays when the refresh leaves nobody in line (`batch` then has no interests).
 */
export function BulkOffer({
  batch: latest,
  tripId,
  bookingPath,
  shopName,
  tripTitle,
  tripWhen,
  copy,
  result,
  locale,
  discount = null,
  discountFields = null,
}: {
  /** The candidates as the server reads them now. */
  batch: BulkOfferBatch;
  tripId: string;
  bookingPath: string;
  shopName: string;
  tripTitle: string;
  tripWhen: string;
  copy: OfferSeatCopy;
  result: BulkOfferResultCopy;
  locale: string;
  /** "Add a discount to offers", for a role that may discount: it rides with this batch and every row's offer. */
  discount?: ReactNode;
  discountFields?: ReactNode;
}) {
  const [held, setBatch] = useState(latest);
  const [answered, setAnswered] = useState<OfferSeatResult[] | null>(null);
  // Mounted with nobody to offer (the card keeps this panel so a spent batch's
  // result outlives the refresh that empties the line): the first people to
  // arrive are the batch.
  const batch = held.interests.length === 0 && !answered ? latest : held;
  const key = idsOf(batch);
  const another = answered !== null && latest.interests.length > 0 && idsOf(latest) !== key;
  const skipped = (answered ?? [])
    .filter((each) => each.delivery === "already_sent")
    .flatMap((each) => batch.interests.filter((one) => one.interestId === each.interestId))
    .map((one) => one.name);
  if (batch.interests.length === 0) return null;
  return (
    <div data-bulk-offer="" className="space-y-3 border-b border-border px-4 pt-2 pb-4 sm:px-6">
      <p className="[overflow-wrap:anywhere]">{batch.names}</p>
      {answered ? (
        <p role="status" data-bulk-offer-result="" className="text-sm font-medium">
          {fill(result.sent, {
            sent: answered.filter((each) => each.delivery === "sent").length,
            total: batch.interests.length,
          })}
          {skipped.length > 0 ? (
            <span className="font-normal text-muted">
              {" "}
              {fill(result.alreadyEmailed, {
                names: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
                  skipped,
                ),
              })}
            </span>
          ) : null}
        </p>
      ) : (
        discount
      )}
      <OfferSeat
        key={key}
        formId="offer-seats-batch"
        tripId={tripId}
        interests={batch.interests}
        label={batch.send}
        bookingPath={bookingPath}
        shopName={shopName}
        tripTitle={tripTitle}
        tripWhen={tripWhen}
        copy={copy}
        discountFields={discountFields}
        once
        onDone={setAnswered}
      />
      {another ? (
        <button
          type="button"
          onClick={() => {
            setBatch(latest);
            setAnswered(null);
          }}
          className={buttonClass({ variant: "link", size: "sm" })}
        >
          {latest.next}
        </button>
      ) : null}
    </div>
  );
}
