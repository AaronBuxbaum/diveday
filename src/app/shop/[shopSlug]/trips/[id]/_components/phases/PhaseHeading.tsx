import type { ReactNode } from "react";
import { type FillingOfferGuests, fillingBulkOffer } from "../bulk-offer";
import { OFFER_SEATS_ID } from "../FillSeatsCard";
import { TripSentenceLine } from "../TripSentenceLine";
import type { tripFrame } from "../trip-frame";
import { LookBackCloseOut } from "./LookBackCloseOut";
import type { PhaseRecordContext } from "./WaterPhase";

export function PhaseHeading({
  frame,
  showDetails,
  cancelled,
  record,
  notBack,
  rollCallHero,
  tripPath,
  fill = null,
  guests,
  meta = null,
  strip,
}: {
  frame: ReturnType<typeof tripFrame>;
  showDetails: boolean;
  cancelled: boolean;
  record: PhaseRecordContext;
  notBack: number;
  rollCallHero: boolean;
  tripPath: string;
  /**
   * Filling's one primary, while the trip takes guests and the add form is
   * not already open: **Offer seats** when this role may offer and somebody
   * is in line (`fillingBulkOffer`), else **Add a guest**.
   */
  fill?: { mayOffer: boolean } | false | null;
  guests: FillingOfferGuests;
  /** Filling's facts line (`TripFactsLine`), under the sentence. */
  meta?: ReactNode;
  strip: ReactNode;
}) {
  if (showDetails) return null;
  const rollCall = rollCallHero
    ? { href: `${tripPath}/manifest`, label: record.t("trips.clock.rollCall") }
    : null;
  const seats = frame.shown === "filling" ? frame.bar : null;
  const filling = frame.shown === "filling" && !cancelled && fill;
  const offer = filling
    ? fillingBulkOffer({
        guests,
        canOffer: filling.mayOffer,
        soldElsewhere: frame.soldElsewhere,
        t: record.t,
        locale: record.locale,
        timezone: record.context.shop.timezone,
      }).length
    : 0;
  const action = !filling
    ? null
    : offer > 0
      ? { href: `#${OFFER_SEATS_ID}`, label: record.t("trips.clock.offerSeats", { count: offer }) }
      : {
          href: `${tripPath}?phase=filling&add=1#add-a-booking`,
          label: record.t("trips.clock.addGuest"),
        };
  const lookBack =
    (frame.lookBack && frame.current === "wrapped") || (cancelled && frame.shown !== "wrapped");
  const showSentence = !cancelled && frame.shown !== "water" && frame.shown !== "wrapped";
  return (
    <div className={lookBack ? "space-y-0" : "space-y-6 sm:space-y-10"}>
      {strip}
      {lookBack || showSentence || meta ? (
        // The facts line belongs to the sentence: one block, closer than the page's stack.
        <div className="space-y-4">
          {lookBack || showSentence ? (
            <div className="space-y-1">
              {lookBack ? (
                <LookBackCloseOut record={record} cancelled={cancelled} notBack={notBack} />
              ) : null}
              {showSentence ? (
                <TripSentenceLine
                  sentence={frame.sentence}
                  rollCall={rollCall}
                  seats={seats}
                  action={action}
                />
              ) : null}
            </div>
          ) : null}
          {meta}
        </div>
      ) : null}
    </div>
  );
}
