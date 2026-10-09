import { ExpiredLinkCard } from "@/components/ExpiredLinkCard";
import type { Shop } from "@/db/schema";
import type { DiverTranslator } from "@/i18n/messages";

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
export function NoShowCard({ shop, t }: { shop: ShopContact; t: DiverTranslator }) {
  return (
    <ExpiredLinkCard
      glyph="cancelled"
      title={t("recap.noShowHeading")}
      text={t("recap.noShowBody", { shop: shop.name })}
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
