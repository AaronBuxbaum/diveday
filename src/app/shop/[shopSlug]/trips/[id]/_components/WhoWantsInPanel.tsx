import type { ReactNode } from "react";
import { GroupLabel } from "@/components/ui/group-label";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { publicTripPath } from "@/lib/public-routes";
import {
  type OfferDiscountCopy,
  OfferDiscountDisclosure,
  OfferDiscountProvider,
  OfferDiscountRider,
} from "./OfferDiscount";
import { OfferSeat } from "./OfferSeat";
import { offeredAgoText, offerSeatCopy } from "./offer-seat-copy";
import { RosterGroup } from "./RosterGroupBand";
import type { WhoWantsInRow } from "./who-wants-in-rows";

/** The element id the Today row, the held send and the Details tab link to. */
export const WHO_WANTS_IN_ID = "who-wants-in";

/** One labelled run of rows. The panel draws a group only when it has rows. */
export type WhoWantsInGroup = {
  /** Stable key: `departure` now, `date` and `anytime` as their layers land. */
  id: string;
  heading: string;
  rows: WhoWantsInRow[];
  /** Rows past the preview cap, behind "Show N more". They are still in the Offer. */
  more?: WhoWantsInRow[];
};

/**
 * **Who wants in** (ADR 20261017-one-interest-with-a-scope): everyone who asked for
 * a seat on this departure, in one panel on the Divers tab, under the roster.
 * Rendered only when some group has a row (principle 9). An interest reserves
 * nothing and is never ranked or filtered by fit (ADR
 * 20260813-wait-list-is-a-lead-list): each group keeps the order people asked
 * in, and a below-the-bar mark informs the staffer without disabling the tick.
 *
 * **One mechanism** (visual review 2026-10-24, A14): every row ends in its own
 * "Offer a seat", one held send to that person; above the list, for a role
 * that may discount, one disclosure, "Add a discount to offers", whose
 * discount rides with whichever row's offer goes next (`OfferDiscount`).
 * Without `canOffer` (the departure takes nobody, or the role may not offer)
 * the names stay and the buttons do not.
 */
export function WhoWantsInPanel({
  groups,
  tripId,
  shopSlug,
  shopName,
  tripTitle,
  tripWhen,
  seatsOpen,
  canOffer,
  carry = null,
  discount = null,
  locale,
}: {
  groups: WhoWantsInGroup[];
  tripId: string;
  shopSlug: string;
  shopName: string;
  tripTitle: string;
  tripWhen: string;
  seatsOpen: number;
  canOffer: boolean;
  /** "Carry who’s waiting": a form the page binds to its action, when there is a departure to carry to. */
  carry?: ReactNode;
  /**
   * "Add a discount to offers": given only to a role that may discount
   * (`mayDiscount`), absent for everyone else, who then see no money control.
   */
  discount?: OfferDiscountCopy | null;
  locale: string;
}) {
  const shown = groups.filter((group) => group.rows.length + (group.more?.length ?? 0) > 0);
  if (shown.length === 0) return null;
  const t = staffTranslator(locale);
  const now = nowDate();
  const rows = shown.flatMap((group) => [...group.rows, ...(group.more ?? [])]);
  const offered = rows.filter((row) => row.offeredAt).length;
  const facts = [
    t("trips.whoWantsIn.seatsOpen", { count: seatsOpen }),
    offered > 0 ? t("trips.whoWantsIn.alreadyOffered", { count: offered }) : null,
  ].filter(Boolean);

  const copy = offerSeatCopy(t);
  const renderRow = (row: WhoWantsInRow) => {
    const body = (
      <div className="min-w-0 text-sm">
        <p className="font-medium text-base">{row.name}</p>
        <p className="text-muted wrap-anywhere">
          {row.facts}
          {row.offeredAt ? (
            <>
              {" · "}
              <span className="font-medium text-foreground">
                {t("trips.whoWantsIn.offeredAgo", {
                  time: offeredAgoText(t, row.offeredAt, now),
                })}
              </span>
            </>
          ) : null}
        </p>
        {/* The fact that decides whether the offer is a good idea,
                    on its own line; warning-toned while any of it is
                    unverified (ADR 20260814-self-declared-cards). */}
        {row.certification ? (
          <p className={row.certification.unchecked ? "text-warning-strong" : "text-muted"}>
            {row.certification.text}
          </p>
        ) : null}
      </div>
    );
    return (
      <li
        key={row.interestId}
        className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 py-2.5"
      >
        {body}
        {canOffer ? (
          <OfferSeat
            formId={`offer-seat-${row.interestId}`}
            tripId={tripId}
            interests={[{ interestId: row.interestId, name: row.name, email: row.email }]}
            ariaLabel={t("trips.whoWantsIn.offerSeatAria", { name: row.name })}
            bookingPath={publicTripPath(shopSlug, tripId)}
            shopName={shopName}
            tripTitle={tripTitle}
            tripWhen={tripWhen}
            copy={copy}
            discountFields={discount ? <OfferDiscountRider /> : null}
          />
        ) : null}
      </li>
    );
  };

  return (
    <RosterGroup
      id={WHO_WANTS_IN_ID}
      label={t("trips.whoWantsIn.heading", { count: rows.length })}
      className="print:hidden"
    >
      <OfferDiscountProvider>
        <div className="space-y-4 px-4 py-3 sm:px-5">
          <p className="text-xs text-muted">
            {facts.join(" · ")}
            {". "}
            {t("trips.whoWantsIn.description")}
          </p>
          {canOffer && discount ? <OfferDiscountDisclosure copy={discount} /> : null}
          {shown.map((group) => (
            <section key={group.id} aria-labelledby={`who-wants-in-${group.id}`}>
              <GroupLabel as="h3" id={`who-wants-in-${group.id}`}>
                {group.heading}
              </GroupLabel>
              <ul className="mt-1 divide-y divide-border">{group.rows.map(renderRow)}</ul>
              {group.more && group.more.length > 0 ? (
                <details className="group/more mt-1">
                  <summary className="min-h-11 cursor-pointer list-none py-2.5 text-sm text-muted underline [&::-webkit-details-marker]:hidden group-open/more:hidden">
                    {t("trips.whoWantsIn.showMore", { count: group.more.length })}
                  </summary>
                  <ul className="divide-y divide-border">{group.more.map(renderRow)}</ul>
                </details>
              ) : null}
            </section>
          ))}
          {carry}
        </div>
      </OfferDiscountProvider>
    </RosterGroup>
  );
}
