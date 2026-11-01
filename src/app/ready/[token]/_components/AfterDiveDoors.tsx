import type { ReactNode } from "react";
import { ExpiredLinkCard } from "@/components/ExpiredLinkCard";
import { PartyClaimPanel } from "@/components/PartyClaimPanel";
import type { AppDb } from "@/db/client";
import type { Shop } from "@/db/schema";
import { issuePartySeatClaims } from "@/db/seat-claims";
import type { DiverTranslator } from "@/i18n/messages";
import { partyClaimSeats } from "./PartySection";

type ShopContact = Pick<Shop, "name" | "contactEmail" | "contactPhone">;

/**
 * **A no-show, said plainly and with somebody to ask.**
 *
 * Both cancellations, the booking's and the departure's, are answered before
 * the after-dive branch, so `getRecapPageData`'s uniform null means
 * `bookings.status = 'no_show'` there (or a cancellation that landed in the
 * microseconds between the two reads, which this notice's contact line covers
 * either way). A held seat is answered before the recap is read
 * (`HeldAfterDiveCard`), so it never reaches this card.
 *
 * It used to render "This readiness link isn't available" over "This booking
 * didn't sail": two sentences, both false for this reader. The token had just
 * verified, and the boat sailed without them. A diver being charged a no-show
 * fee, holding DiveDay's own page telling them the trip never ran, is where a
 * chargeback argument starts.
 */
export function NoShowCard({
  shop,
  t,
  turnedAway = false,
}: {
  shop: ShopContact;
  t: DiverTranslator;
  /**
   * The desk saw this diver and could not take them (H-20261015-who-may-turn-someone). "Marked as a
   * no-show" would be false to the one reader who knows it.
   */
  turnedAway?: boolean;
}) {
  return (
    <ExpiredLinkCard
      glyph="cancelled"
      title={turnedAway ? t("recap.turnedAwayHeading") : t("recap.noShowHeading")}
      text={
        turnedAway
          ? t("recap.turnedAwayBody", { shop: shop.name })
          : t("recap.noShowBody", { shop: shop.name })
      }
      shop={shop}
      t={t}
    />
  );
}

/**
 * **A held seat after the dive** (security review of issue #2125). The recap
 * reads nothing for a seat whose diver the desk has not confirmed, and that
 * null used to read as "marked as a no-show", a false fact about somebody who
 * may well have dived. This card says only that the shop has it, and who to
 * ask.
 */
export function HeldAfterDiveCard({ shop, t }: { shop: ShopContact; t: DiverTranslator }) {
  return (
    <ExpiredLinkCard
      glyph="quiet"
      title={t("recap.heldHeading")}
      text={t("recap.heldBody", { shop: shop.name })}
      shop={shop}
      t={t}
    />
  );
}

/**
 * **A seat the desk released, before the day is over** (layer 3 review, dde-1
 * F2 and dde-2 #1): turned away at the counter, or marked not here once the
 * boat left. Everything the page draws after this point (the spine, the
 * checklist, the Pay step, "running late") is about a seat the diver still
 * holds: a diver turned away at 07:00 who signs and pays at 07:10 has paid for
 * a seat the shop may have sold, and walks to a boat expecting a place. So the
 * page answers here, after the after-dive branch that owns the finished day:
 * the shop released the seat, talk to the desk. Never the reason: a bearer
 * link is no place to print a medical or card category.
 */
export function ReleasedSeatCard({
  shop,
  t,
  children,
}: {
  shop: ShopContact;
  t: DiverTranslator;
  /** A party lead's claim panel: their members' seats are still held (dde-3 #7). */
  children?: ReactNode;
}) {
  return (
    <ExpiredLinkCard
      glyph="quiet"
      title={t("ready.seatReleasedHeading")}
      text={t("ready.seatReleasedBody")}
      shop={shop}
      t={t}
    >
      {children}
    </ExpiredLinkCard>
  );
}

/**
 * The released seat's page. A party's lead keeps the links their party claims
 * seats with, because the members' seats are still held (layer 3 re-review,
 * dde-3 #7); everyone else gets the card alone (the panel renders nothing).
 */
export async function releasedSeat(
  db: AppDb,
  shopId: string,
  bookingId: string,
  locale: string,
  shop: ShopContact,
  t: DiverTranslator,
) {
  const claims = await issuePartySeatClaims(db, { shopId, leadBookingId: bookingId });
  return (
    <ReleasedSeatCard shop={shop} t={t}>
      <PartyClaimPanel locale={locale} seats={partyClaimSeats(claims)} />
    </ReleasedSeatCard>
  );
}
