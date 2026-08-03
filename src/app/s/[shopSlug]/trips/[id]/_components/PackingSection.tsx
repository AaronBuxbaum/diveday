import type { DiverMessageKey } from "@/i18n/messages";
import { diverTranslator } from "@/i18n/messages";
import { dockDayTimeline, type ProvidedItemCode, packingConfidence } from "@/lib/diver-planning";
import type { RentableItemKind } from "@/lib/rentals";
import type { RentalFit, Shop, Trip } from "./types";

/**
 * `packingConfidence` returns codes, not prose (src/lib/diver-planning.ts) —
 * these maps are where each one becomes a word in the diver bundle. Its own
 * namespace: `RentableItemKind` is also the code `src/lib/dive-prep.ts` (the
 * staff-side rental prep list) resolves against `staff.json` — the English
 * words happen to match, but the two bundles stay independent on purpose.
 */
const RENTAL_ITEM_KEYS: Record<RentableItemKind, DiverMessageKey> = {
  bcd: "trip.rentalItems.bcd",
  regulator: "trip.rentalItems.regulator",
  wetsuit: "trip.rentalItems.wetsuit",
  mask_fins: "trip.rentalItems.maskFins",
  weights: "trip.rentalItems.weights",
  dive_computer: "trip.rentalItems.diveComputer",
  gopro: "trip.rentalItems.gopro",
};

const PROVIDED_ITEM_KEYS: Record<ProvidedItemCode, DiverMessageKey> = {
  tanksAndWeights: "trip.providedItems.tanksAndWeights",
  crewBriefing: "trip.providedItems.crewBriefing",
};

const TEMPERATURE_TIP_KEYS: Record<"cold" | "mild", DiverMessageKey> = {
  cold: "trip.temperatureTip.cold",
  mild: "trip.temperatureTip.mild",
};

export function PackingSection({
  shop,
  trip,
  rentalFit,
  locale,
}: {
  shop: Shop;
  trip: Trip;
  rentalFit?: RentalFit;
  locale: string;
}) {
  const packing = packingConfidence(shop.packingList, rentalFit ?? null, trip.waterTemperatureC);
  const t = diverTranslator(locale);
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">{t("trip.packTitle")}</h2>
      {packing.temperatureTip ? (
        <p className="mt-2 text-sm text-muted">
          {t(TEMPERATURE_TIP_KEYS[packing.temperatureTip.tone], {
            celsius: packing.temperatureTip.celsius,
          })}
        </p>
      ) : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <h3 className="font-semibold">{t("trip.packBring")}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {packing.bring.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-semibold">{t("trip.packRenting")}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {packing.rented.length ? (
              packing.rented.map((kind) => <li key={kind}>{t(RENTAL_ITEM_KEYS[kind])}</li>)
            ) : (
              <li>{t("trip.packNothingRequested")}</li>
            )}
          </ul>
        </div>
        <div>
          <h3 className="font-semibold">{t("trip.packProvided")}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {packing.provided.map((code) => (
              <li key={code}>{t(PROVIDED_ITEM_KEYS[code])}</li>
            ))}
          </ul>
        </div>
      </div>
      <h3 className="mt-5 font-semibold">{t("trip.dockDayRhythm")}</h3>
      <ol className="mt-2 space-y-1 text-sm text-muted">
        {dockDayTimeline(trip.startsAt, shop.dockCallMinutes, trip.endsAt).map((entry) => (
          <li key={entry.step}>
            {t(`trip.timeline.${entry.step}`)} ·{" "}
            {entry.at.toLocaleTimeString(locale, {
              hour: "numeric",
              minute: "2-digit",
              timeZone: shop.timezone,
            })}
          </li>
        ))}
      </ol>
    </section>
  );
}
