// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { type ReactNode, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { OfferSeat, type OfferSeatCopy, type OfferSeatInterest } from "./OfferSeat";

/** One batch of "Offer seats": who it writes to, in the words that name them. */
export type BulkOfferBatch = {
  interests: OfferSeatInterest[];
  /** "Ravi Menon, Hana Kobayashi and Naledi Khumalo each get the booking link by email." */
  names: string;
  /** "Send 3 offers" */
  send: string;
  /** "Offer the next 3", drawn once this batch is spent and another waits. */
  next: string;
};

const idsOf = (batch: BulkOfferBatch) => batch.interests.map((each) => each.interestId).join(",");

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
 */
export function BulkOffer({
  batch: latest,
  tripId,
  bookingPath,
  shopName,
  tripTitle,
  tripWhen,
  copy,
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
  discountFields?: ReactNode;
}) {
  const [batch, setBatch] = useState(latest);
  const [spent, setSpent] = useState(false);
  const key = idsOf(batch);
  const another = spent && latest.interests.length > 0 && idsOf(latest) !== key;
  return (
    <div data-bulk-offer="" className="space-y-3">
      <p className="text-sm [overflow-wrap:anywhere]">{batch.names}</p>
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
        onDone={() => setSpent(true)}
      />
      {another ? (
        <button
          type="button"
          onClick={() => {
            setBatch(latest);
            setSpent(false);
          }}
          className={buttonClass({ variant: "link", size: "sm" })}
        >
          {latest.next}
        </button>
      ) : null}
    </div>
  );
}
