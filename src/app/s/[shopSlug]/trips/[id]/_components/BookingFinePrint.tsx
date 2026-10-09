import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { diverTranslator } from "@/i18n/messages";
import { TripTerms } from "./TripTerms";
import type { Shop, Trip } from "./types";

/**
 * The fine print under the booking button: the cancellation window
 * (`TripTerms`) and, on the canonical demo only, that it is one shop every
 * visitor shares, so what is typed into its form is there for the next visitor
 * to read. A visitor's own minted demo is theirs alone and says nothing.
 */
export function BookingFinePrint({
  shop,
  trip,
  locale,
}: {
  shop: Shop;
  trip: Trip;
  locale: string;
}) {
  const sharedDemo = shop.isDemo && shop.slug === DEMO_SHOP_SLUG;
  return (
    <>
      <TripTerms shop={shop} trip={trip} locale={locale} />
      {sharedDemo ? (
        <p className="mt-3 text-sm text-muted">{diverTranslator(locale)("trip.sharedDemoNote")}</p>
      ) : null}
    </>
  );
}
