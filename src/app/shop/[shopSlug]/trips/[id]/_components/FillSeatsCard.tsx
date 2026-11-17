import type { ReactNode } from "react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { GroupLabel } from "@/components/ui/group-label";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { publicTripPath } from "@/lib/public-routes";
import { WHO_WANTS_IN_ID } from "@/lib/trip-clock";
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

const ROW_CLASS = "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6";
const BADGE_CLASS =
  "flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-tint text-sm font-semibold text-primary";

/**
 * **Fill the last N** (ADR 20261117-trip-page-clock, Filling): every way to
 * fill a seat, in one card. Who asked for a seat, each with **Offer a seat**;
 * the past guests worth inviting; the booking link; and adding a guest by
 * hand. An interest reserves nothing and is never ranked by fit (ADR
 * 20260813-wait-list-is-a-lead-list): each group keeps the order people asked in.
 *
 * **One place, one permission rule**: Offer a seat and Invite are drawn only
 * for a role that may act on the wait list (`mayInviteFromWaitlist`, the
 * audience `holdSendAction` itself holds), and only while the trip takes a
 * guest. The names stay either way.
 */
export function FillSeatsCard({
  heading,
  groups,
  pastGuests,
  canOffer,
  discount,
  addHref,
  addForm,
  carry,
  trip,
  t,
}: {
  heading: string;
  groups: WhoWantsInGroup[];
  /** The past guests worth inviting, already drawn (`InviteSuggestionsGroup`), with their count. */
  pastGuests: { count: number; line: string; list: ReactNode } | null;
  canOffer: boolean;
  discount: OfferDiscountCopy | null;
  /** "Add a guest yourself": where its Add goes; null when the trip takes nobody. */
  addHref: string | null;
  /** The add form itself, once asked for (`?add=1`). */
  addForm: ReactNode;
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
              {" · "}
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
          copy={copy}
          discountFields={discount ? <OfferDiscountRider /> : null}
        />
      ) : null}
    </li>
  );

  return (
    <section
      id={WHO_WANTS_IN_ID}
      aria-labelledby="fill-seats-heading"
      data-fill-seats
      className={sectionCardClass({ padding: "none", className: "scroll-mt-24 overflow-hidden" })}
    >
      <OfferDiscountProvider>
        <h2 id="fill-seats-heading" className="px-4 pt-4 pb-1 font-semibold sm:px-6">
          {heading}
        </h2>
        {canOffer && discount && shown.length > 0 ? (
          <div className="px-4 sm:px-6">
            <OfferDiscountDisclosure copy={discount} />
          </div>
        ) : null}
        <ul className="divide-y divide-border">
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
          {pastGuests && canOffer ? (
            <li>
              <details className="group/past">
                <summary
                  className={`${ROW_CLASS} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
                >
                  <span aria-hidden="true" className={BADGE_CLASS}>
                    {pastGuests.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {t("trips.clock.filling.pastGuests", { count: pastGuests.count })}
                    </span>
                    <span className="block text-sm text-muted">{pastGuests.line}</span>
                  </span>
                  <span className={buttonClass({ variant: "secondary", size: "sm" })}>
                    {t("trips.clock.filling.invite")}
                  </span>
                </summary>
                <div className="border-t border-border">{pastGuests.list}</div>
              </details>
            </li>
          ) : null}
          <li className={ROW_CLASS}>
            <span aria-hidden="true" className={BADGE_CLASS}>
              ↗
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{t("trips.clock.filling.bookingLink")}</span>
              <span className="block text-sm text-muted">
                {t("trips.clock.filling.bookingLinkLine")}
              </span>
            </span>
            <CopyLinkButton
              path={publicTripPath(trip.shopSlug, trip.id)}
              label={t("trips.detail.copyBookingLink")}
              copiedLabel={t("words.did.copied")}
              failedLabel={t("trips.detail.linkCopyFailed")}
              variant="secondary"
            />
          </li>
          {addHref ? (
            <li>
              <div className={ROW_CLASS}>
                <span aria-hidden="true" className={BADGE_CLASS}>
                  +
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {t("trips.clock.filling.addYourself")}
                  </span>
                  <span className="block text-sm text-muted">
                    {t("trips.clock.filling.addYourselfLine")}
                  </span>
                </span>
                {addForm ? null : (
                  <a href={addHref} className={buttonClass({ variant: "secondary", size: "sm" })}>
                    {t("trips.clock.filling.add")}
                  </a>
                )}
              </div>
              {addForm}
            </li>
          ) : null}
        </ul>
      </OfferDiscountProvider>
    </section>
  );
}
