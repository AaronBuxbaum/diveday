import { arrivalCardFacts, arrivalCardShopOf } from "@/components/arrival-card-facts";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import { PERSONAL_GEAR_KEYS, RENTAL_ITEM_KEYS } from "@/i18n/packing-labels";
import { packingConfidence } from "@/lib/diver-planning";
import { formatMoneyCents } from "@/lib/format";
import { openMapsUrl } from "@/lib/maps";
import { CORE_RENTAL_KINDS, offeredRentableItems, quoteRentalFit } from "@/lib/rentals";
import { PROVIDED_ITEM_KEYS } from "./PackingSection";
import { TripTerms } from "./TripTerms";
import type { Shop, Trip } from "./types";

/** The same packing, meeting point and quote rules as the booked diver's page. */
export function TripBookingFacts({
  shop,
  trip,
  locale,
}: {
  shop: Shop;
  trip: Trip;
  locale: string;
}) {
  const t = diverTranslator(locale);
  const included = trip.course?.includedRentalKinds ?? [];
  const offered = offeredRentableItems(shop.rentalItems).map((item) => item.kind);
  const packing = packingConfidence(
    shop.packingList,
    null,
    shop.briefingMinutes > 0,
    included,
    offered.filter((kind) => shop.rentalPricing.perItemCents[kind] !== 0),
    trip.course?.includedPersonalGear ?? [],
  );
  const rentable = offered.filter((kind) => !included.includes(kind));
  const quote = (kinds: typeof rentable) =>
    quoteRentalFit(shop.rentalPricing, {
      rentedKinds: kinds,
      offeredKinds: offered,
      wantsNitrox: false,
      plannedDives: trip.plannedDives,
    });
  const prices = rentable.flatMap((kind) => {
    const value = quote([kind]);
    return value.unpricedKinds.length === 0 && value.subtotalCents > 0 ? [value.subtotalCents] : [];
  });
  const core = CORE_RENTAL_KINDS.filter((kind) => offered.includes(kind));
  const fullSet =
    core.length > 0 && core.every((kind) => !included.includes(kind)) ? quote(core) : null;
  const fullSetPrice =
    fullSet && fullSet.unpricedKinds.length === 0 && fullSet.subtotalCents > 0
      ? fullSet.subtotalCents
      : null;
  const where = arrivalCardFacts(arrivalCardShopOf(shop), trip);
  const bring = [
    ...packing.bringPersonal.map((code) => t(PERSONAL_GEAR_KEYS[code])),
    ...packing.bring,
  ];
  const provided = [
    ...packing.provided.map((code) => t(PROVIDED_ITEM_KEYS[code])),
    ...packing.providedKinds.map((kind) => t(RENTAL_ITEM_KEYS[kind])),
    ...packing.providedPersonal.map((code) => t(PERSONAL_GEAR_KEYS[code])),
  ];
  return (
    <section className="mt-10 lg:mt-0" aria-labelledby="trip-booking-facts">
      <h2 id="trip-booking-facts" className={SECTION_TITLE_CLASS}>
        {t("trip.goodToKnow")}
      </h2>
      <dl className="mt-4 grid gap-4 text-base sm:grid-cols-2">
        <div>
          <dt className="font-semibold">{t("trip.packProvided")}</dt>
          <dd className="mt-1 text-muted">
            <ul>
              {provided.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </dd>
        </div>
        {prices.length > 0 ? (
          <div>
            <dt className="font-semibold">
              {t("trip.rentalFrom", {
                price: formatMoneyCents(Math.min(...prices), shop.currency, locale),
              })}
            </dt>
            {fullSetPrice !== null ? (
              <dd className="mt-1 text-muted">
                {t("trip.rentalFullSet", {
                  price: formatMoneyCents(fullSetPrice, shop.currency, locale),
                })}
              </dd>
            ) : null}
          </div>
        ) : null}
        {bring.length > 0 ? (
          <div>
            <dt className="font-semibold">{t("trip.packBring")}</dt>
            <dd className="mt-1 text-muted">
              <ul>
                {bring.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {where.address || trip.meetingPointLabel ? (
          <div>
            <dt className="font-semibold">{where.label}</dt>
            {where.address ? (
              <dd className="mt-1 text-muted">
                {where.mapQuery ? (
                  <a
                    href={openMapsUrl(where.mapQuery)}
                    className="inline-flex min-h-11 items-center underline underline-offset-4"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {where.address}
                  </a>
                ) : (
                  where.address
                )}
              </dd>
            ) : null}
          </div>
        ) : null}
      </dl>
      <TripTerms shop={shop} trip={trip} locale={locale} />
    </section>
  );
}
