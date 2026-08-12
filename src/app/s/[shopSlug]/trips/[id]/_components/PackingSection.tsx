import type { DiverMessageKey } from "@/i18n/messages";
import { diverTranslator } from "@/i18n/messages";
import {
  dockDayTimeline,
  type ProvidedItemCode,
  packingConfidence,
  type SiteBottomTimes,
} from "@/lib/diver-planning";
import type { RentableItemKind } from "@/lib/rentals";
import type { RentalFit, Shop, Trip } from "./types";

/**
 * `packingConfidence` returns codes, not prose (src/lib/diver-planning.ts) —
 * these maps are where each one becomes a word in the diver bundle. Its own
 * namespace: `RentableItemKind` is also the code `src/lib/dive-prep.ts` (the
 * staff-side rental prep list) resolves against the staff bundle — the English
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

export function PackingSection({
  shop,
  trip,
  rentalFit,
  day,
  multiDay,
  siteBottomTimes,
  locale,
}: {
  shop: Shop;
  trip: Trip;
  rentalFit?: RentalFit;
  /**
   * The one meeting day this rhythm is laid over. Defaults to the trip's own
   * window, which for a single-day departure is the same thing.
   *
   * It is emphatically *not* the same thing on a course weekend: `trip.endsAt`
   * on a three-day Open Water is the last day's 5:00 PM, so laying the rhythm
   * over the trip row printed a day that departed at day one's 8:00 AM and came
   * home at day three's 5:00 PM — a nine-hour morning nobody sells.
   */
  day?: { startsAt: Date; endsAt: Date };
  /** Whether this departure meets on more than one day — the rhythm repeats. */
  multiDay: boolean;
  /**
   * Each planned dive's own time in the water, dive 1 first, where the site it
   * visits names one. Absent entries fall back to the shop's own figure — see
   * `SiteBottomTimes`.
   */
  siteBottomTimes?: SiteBottomTimes;
  locale: string;
}) {
  const window = day ?? trip;
  const packing = packingConfidence(shop.packingList, rentalFit ?? null, shop.briefingMinutes > 0);
  const t = diverTranslator(locale);
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-5">
      {/* No "water is expected around 24°C — use the shop's wetsuit
          guidance" line here any more. It restated the reading from the
          forecast card a few inches above and then pointed at advice it did
          not give; that card now names the suit itself (`exposureSuitFor`,
          src/lib/diver-planning.ts), which is the thing this sentence was
          gesturing at, said once and with a thickness in it. */}
      <h2 className="text-lg font-semibold">{t("trip.packTitle")}</h2>
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
      {/* The shop's own minutes laid over this departure's clock, for this
          departure's own dive count — not the trip window's thirds, which is
          what this list used to be. A multi-day course runs the same shape each
          day, and says so rather than implying it only happens once. */}
      {multiDay ? <p className="mt-1 text-sm text-muted">{t("trip.dockDayEachDay")}</p> : null}
      <ol className="mt-2 space-y-1 text-sm text-muted">
        {dockDayTimeline(
          window.startsAt,
          shop,
          window.endsAt,
          trip.plannedDives,
          siteBottomTimes,
        ).map((entry) => (
          <li key={`${entry.step}-${entry.number ?? 0}`}>
            {t(`trip.timeline.${entry.step}`, { number: entry.number ?? 1 })} ·{" "}
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
