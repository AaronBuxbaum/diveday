import Link from "next/link";
import type { ReactNode } from "react";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { PersonAvatar } from "@/components/PersonAvatar";
import { ScrollToHash } from "@/components/ScrollToHash";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { GroupLabel } from "@/components/ui/group-label";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { publicTripPath } from "@/lib/public-routes";
import { WHO_WANTS_IN_ID } from "@/lib/trip-clock";
import {
  BulkOffer,
  type BulkOfferBatch,
  type BulkOfferResultCopy,
  OfferSeatsReveal,
} from "./BulkOffer";
import { CopyLinkButton } from "./CopyLinkButton";
import {
  type OfferDiscountCopy,
  OfferDiscountDisclosure,
  OfferDiscountProvider,
  OfferDiscountRider,
} from "./OfferDiscount";
import { OfferSeat } from "./OfferSeat";
import { offeredAgoText, offerSeatCopy } from "./offer-seat-copy";
import type { WhoWantsInRow } from "./who-wants-in-rows";

/** One labelled run of wait-list rows. The card draws a group only when it has rows. */
export type WhoWantsInGroup = {
  /** Stable key: `departure`, `date` or `anytime`. */
  id: string;
  heading: string;
  rows: WhoWantsInRow[];
  /** Rows past the preview cap, behind "Show N more". */
  more?: WhoWantsInRow[];
};

/** Where the page's "Offer seats" lands: the batch's own disclosure. */
export const OFFER_SEATS_ID = "offer-seats";

const ROW_CLASS = "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6";
const ROW_LINK = buttonClass({ variant: "link", flush: true });

/**
 * **Fill the last N** (ADR 20261117-trip-page-clock, Filling): every way to
 * fill a seat, in one card. Who asked for a seat, each with **Offer a seat**,
 * and **Offer seats** to the first few of them at once (`bulkOfferCandidates`),
 * in a panel the page's primary opens;
 * **Share**, which folds the past guests worth inviting and the booking link;
 * and adding a guest by hand. An interest reserves nothing and is never ranked by fit (ADR
 * 20260813-wait-list-is-a-lead-list): each group keeps the order people asked in.
 *
 * **One place, one permission rule**: Offer a seat and Invite are drawn only
 * for a role that may act on the wait list (`mayInviteFromWaitlist`, the
 * audience `holdSendAction` itself holds), and only while the trip takes a
 * guest. The names stay either way.
 *
 * **Sold elsewhere** (`soldElsewhere`): the caller passes no past guests,
 * and `addLabel` for the add row; the booking link is left off, since the
 * seats are sold somewhere else.
 */
export function FillSeatsCard({
  heading,
  groups,
  pastGuests,
  bulk = null,
  canOffer,
  discount,
  addHref,
  addForm,
  addLabel,
  bookingLink = true,
  carry,
  trip,
  t,
}: {
  heading: string;
  groups: WhoWantsInGroup[];
  /** The past guests worth inviting, already drawn (`InviteSuggestionsGroup`), with their count. */
  pastGuests: { count: number; list: ReactNode } | null;
  /**
   * "Offer seats": the batch the page's primary opens (`#offer-seats`), named
   * before it is sent. Given whenever this role may offer on this departure,
   * with no interests while nobody is in line; null where no offer is made.
   */
  bulk?: { batch: BulkOfferBatch; result: BulkOfferResultCopy; locale: string } | null;
  canOffer: boolean;
  discount: OfferDiscountCopy | null;
  /** "Add a guest yourself": where its Add goes; null when the trip takes nobody. */
  addHref: string | null;
  /** The add form itself, once asked for (`?add=1`). */
  addForm: ReactNode;
  /** The add row's words; "Add a guest yourself" when not given. */
  addLabel?: string;
  /** Draw the booking link's row: off on a departure sold elsewhere. */
  bookingLink?: boolean;
  /** "Carry who’s waiting" to another departure, on a full boat. */
  carry: ReactNode;
  trip: { id: string; shopSlug: string; shopName: string; title: string; when: string };
  t: StaffTranslator;
}) {
  const shown = groups.filter((group) => group.rows.length + (group.more?.length ?? 0) > 0);
  const labelled = shown.length > 1;
  const now = nowDate();
  const copy = offerSeatCopy(t);
  const renderRow = (row: WhoWantsInRow) => (
    <li key={row.interestId} className={ROW_CLASS}>
      <PersonAvatar name={row.name} photoPath={null} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold [overflow-wrap:anywhere]">{row.name}</p>
        <p className="text-sm text-muted wrap-anywhere">
          {row.facts}
          {row.certification ? (
            <>
              {row.facts ? " · " : null}
              <span className={row.certification.unchecked ? "text-warning-strong" : undefined}>
                {row.certification.text}
              </span>
            </>
          ) : null}
          {row.offeredAt ? (
            <>
              {" · "}
              <span className="font-medium text-foreground">
                {t("trips.whoWantsIn.offeredAgo", { time: offeredAgoText(t, row.offeredAt, now) })}
              </span>
            </>
          ) : null}
        </p>
      </div>
      {canOffer ? (
        <OfferSeat
          formId={`offer-seat-${row.interestId}`}
          tripId={trip.id}
          interests={[{ interestId: row.interestId, name: row.name, email: row.email }]}
          ariaLabel={t("trips.whoWantsIn.offerSeatAria", { name: row.name })}
          bookingPath={publicTripPath(trip.shopSlug, trip.id)}
          shopName={trip.shopName}
          tripTitle={trip.title}
          tripWhen={trip.when}
          label={t("trips.whoWantsIn.offer")}
          copy={copy}
          discountFields={discount ? <OfferDiscountRider key="discount" /> : null}
          quiet
        />
      ) : null}
    </li>
  );

  // The add row, last among the ways to fill a seat; first once its form is
  // open, so the form opens right under the guests it adds to.
  const addLine = addLabel ?? t("trips.clock.filling.addYourself");
  const addRow = addHref ? (
    <li>
      <div className={ROW_CLASS}>
        {addForm ? (
          <span className="font-semibold">{addLine}</span>
        ) : (
          <Link href={addHref} scroll={false} className={ROW_LINK}>
            {addLine}
          </Link>
        )}
      </div>
      {addForm}
    </li>
  ) : null;

  // Past guests are invited only by a role that may act on the wait list.
  const past = pastGuests && canOffer ? pastGuests : null;
  const discountToggle =
    canOffer && discount && shown.length > 0 ? <OfferDiscountDisclosure copy={discount} /> : null;
  const hasBatch = Boolean(bulk && bulk.batch.interests.length > 0);
  const linkRow = (
    <>
      <span className="min-w-0 flex-1">{t("trips.clock.filling.bookingLink")}</span>
      <CopyLinkButton
        path={publicTripPath(trip.shopSlug, trip.id)}
        label={t("trips.detail.copyBookingLink")}
        copiedLabel={t("words.did.copied")}
        failedLabel={t("trips.detail.linkCopyFailed")}
      />
    </>
  );

  return (
    <section
      id={WHO_WANTS_IN_ID}
      aria-labelledby="fill-seats-heading"
      data-fill-seats
      className={sectionCardClass({ padding: "none", className: "scroll-mt-24 overflow-hidden" })}
    >
      {/* Mounted with the card, so `#who-wants-in` and `#invite-suggestions` land here. */}
      <ScrollToHash />
      <OfferDiscountProvider>
        <h2 id="fill-seats-heading" className="px-4 pt-4 pb-1 font-semibold sm:px-6">
          {heading}
        </h2>
        {bulk ? (
          // The page's primary, "Offer seats", opens this: who it writes to,
          // the discount that rides with it (and with each row's offer), the
          // press. Kept while nobody is in line, so a spent batch's result stays.
          <OfferSeatsReveal id={OFFER_SEATS_ID}>
            <BulkOffer
              batch={bulk.batch}
              result={bulk.result}
              locale={bulk.locale}
              tripId={trip.id}
              bookingPath={publicTripPath(trip.shopSlug, trip.id)}
              shopName={trip.shopName}
              tripTitle={trip.title}
              tripWhen={trip.when}
              copy={copy}
              discount={hasBatch ? discountToggle : null}
              discountFields={discount ? <OfferDiscountRider key="discount" /> : null}
            />
          </OfferSeatsReveal>
        ) : null}
        {!hasBatch && discountToggle ? <div className="px-4 sm:px-6">{discountToggle}</div> : null}
        <ul className="divide-y divide-border">
          {addForm ? addRow : null}
          {shown.map((group) => (
            <li key={group.id}>
              {labelled ? (
                <GroupLabel as="h3" className="px-4 pt-3 sm:px-6">
                  {group.heading}
                </GroupLabel>
              ) : null}
              <ul className="divide-y divide-border">{group.rows.map(renderRow)}</ul>
              {group.more && group.more.length > 0 ? (
                <details className="group/more">
                  <summary className="min-h-11 cursor-pointer list-none px-4 py-2.5 text-sm text-muted underline sm:px-6 [&::-webkit-details-marker]:hidden group-open/more:hidden">
                    {t("trips.whoWantsIn.showMore", { count: group.more.length })}
                  </summary>
                  <ul className="divide-y divide-border">{group.more.map(renderRow)}</ul>
                </details>
              ) : null}
            </li>
          ))}
          {carry ? <li className="px-4 pb-4 sm:px-6">{carry}</li> : null}
          {past ? (
            <li>
              {/* Today's "Invite past divers" (`#invite-suggestions`) lands here, open. */}
              <AutoOpenDetails openOnHash="invite-suggestions" className="group/share">
                <summary
                  className={`${ROW_CLASS} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-primary">
                      {t("trips.clock.filling.share")}
                    </span>
                    <span className="block text-sm text-muted">
                      {t("trips.clock.filling.shareLine", { count: past.count })}
                    </span>
                  </span>
                  <DisclosureCaret
                    direction="down"
                    className="size-5 text-muted group-open/share:rotate-180"
                  />
                </summary>
                {bookingLink ? <div className={`${ROW_CLASS} pt-0`}>{linkRow}</div> : null}
                <div className="border-t border-border">{past.list}</div>
              </AutoOpenDetails>
            </li>
          ) : bookingLink ? (
            <li className={ROW_CLASS}>{linkRow}</li>
          ) : null}
          {addForm ? null : addRow}
        </ul>
      </OfferDiscountProvider>
    </section>
  );
}
