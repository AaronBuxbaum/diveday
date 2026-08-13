import type { DiverMessageKey } from "@/i18n/messages";
import { diverTranslator } from "@/i18n/messages";
import {
  dockDayTimeline,
  exposureSuitFor,
  type ProvidedItemCode,
  packingConfidence,
  type SiteBottomTimes,
} from "@/lib/diver-planning";
import type { RentableItemKind } from "@/lib/rentals";
import { EXPOSURE_SUIT_KEYS } from "./exposure-suit";
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
  temperatureStatedAbove,
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
  /**
   * Whether a conditions card above this one already states the water
   * temperature — and with it the suit most divers want (`ForecastSection`).
   *
   * The booking page renders that card and passes `true`, so the advice is
   * given once, under the reading it is derived from. `/ready/[token]` renders
   * this section with **no** conditions card anywhere on the page and passes
   * `false`, so the suit line lands here instead: the morning of a dive is
   * when a diver is deciding what to put in the car, and that page would
   * otherwise say nothing at all about the water they are getting into.
   *
   * An explicit prop, not a guess from `trip.waterTemperatureC`: which sections
   * a page renders is the page's own knowledge, and the two surfaces have
   * genuinely different layouts rather than one being a subset of the other.
   */
  temperatureStatedAbove: boolean;
  locale: string;
}) {
  const window = day ?? trip;
  const packing = packingConfidence(shop.packingList, rentalFit ?? null, shop.briefingMinutes > 0);
  const t = diverTranslator(locale);
  // Said here only when nothing above has said it. This used to be an
  // unconditional "water is expected around 24°C — use the shop's wetsuit
  // guidance", which on the booking page restated the reading from the
  // conditions card a few inches up and then pointed at advice it did not
  // give. The card now names the suit itself; this is the same sentence, on
  // the one page that has no card to put it on.
  const exposureSuit =
    temperatureStatedAbove || trip.waterTemperatureC === null
      ? null
      : exposureSuitFor(trip.waterTemperatureC);
  return (
    // No outer card, same reasoning as `ForecastSection`: this is pre-trip
    // reading, not a decision, and the three columns plus the rhythm below are
    // their own shape. The heading steps up to the briefings section's scale
    // so the page's supporting reading reads as one system.
    <section className="mt-12">
      <h2 className="text-2xl font-semibold tracking-tight">{t("trip.packTitle")}</h2>
      {exposureSuit ? (
        <p className="mt-2 text-sm text-muted">{t(EXPOSURE_SUIT_KEYS[exposureSuit])}</p>
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
      <h3 className="mt-6 font-semibold">{t("trip.dockDayRhythm")}</h3>
      {/* The shop's own minutes laid over this departure's clock, for this
          departure's own dive count — not the trip window's thirds, which is
          what this list used to be. A multi-day course runs the same shape each
          day, and says so rather than implying it only happens once. */}
      {multiDay ? <p className="mt-1 text-sm text-muted">{t("trip.dockDayEachDay")}</p> : null}
      {/* Time first, in an aligned tabular column: a schedule is read by the
          clock, and the ragged "label · time" lines it replaces made the eye
          hunt for every time inside a sentence. The alignment is the shape —
          no rule or box needed. */}
      <ol className="mt-3 space-y-1.5 text-sm">
        {dockDayTimeline(
          window.startsAt,
          shop,
          window.endsAt,
          trip.plannedDives,
          siteBottomTimes,
        ).map((entry) => (
          <li key={`${entry.step}-${entry.number ?? 0}`} className="flex gap-4">
            <span className="w-24 shrink-0 font-medium tabular-nums">
              {entry.at.toLocaleTimeString(locale, {
                hour: "numeric",
                minute: "2-digit",
                timeZone: shop.timezone,
              })}
            </span>
            <span className="text-muted">
              {t(`trip.timeline.${entry.step}`, { number: entry.number ?? 1 })}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
