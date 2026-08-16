import type { DiverMessageKey } from "@/i18n/messages";
import { diverTranslator } from "@/i18n/messages";
import {
  dockDayTimeline,
  exposureSuitFor,
  type LegTravelTimes,
  type ProvidedItemCode,
  packingConfidence,
  type SiteBottomTimes,
  type DockDayStep,
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

function StepIcon({ step, className }: { step: DockDayStep; className?: string }) {
  switch (step) {
    case "arrive":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      );
    case "gearSetup":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <path d="M12 22V12" />
          <path d="m12 12 8.7-5" />
          <path d="m12 12-8.7-5" />
        </svg>
      );
    case "briefing":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case "departure":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <path d="M2 17h20" />
          <path d="M5 17h14v-2.5l-2-2H7l-2 2z" />
          <path d="M12 12.5V8.5" />
          <path d="M12 8.5h3L12 5.5v3Z" />
        </svg>
      );
    case "boatRide":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <path d="M2 6c.6 0 1.2-.2 1.6-.6L5 4.3c.8-.8 2-.8 2.8 0l1.3 1.1c.4.4 1 .6 1.6.6s1.2-.2 1.6-.6l1.3-1.1c.8-.8 2-.8 2.8 0l1.3 1.1c.4.4 1 .6 1.6.6" />
          <path d="M2 12c.6 0 1.2-.2 1.6-.6l1.3-1.1c.8-.8 2-.8 2.8 0l1.3 1.1c.4.4 1 .6 1.6.6s1.2-.2 1.6-.6l1.3-1.1c.8-.8 2-.8 2.8 0l1.3 1.1c.4.4 1 .6 1.6.6" />
        </svg>
      );
    case "dive":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <circle cx="8" cy="12" r="3" />
          <circle cx="16" cy="12" r="3" />
          <path d="M11 12h2" />
          <path d="M5 12h1" />
          <path d="M18 12h1" />
          <path d="M12 7v5" />
        </svg>
      );
    case "surfaceInterval":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
          <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
          <line x1="6" y1="2" x2="6" y2="4" />
          <line x1="10" y1="2" x2="10" y2="4" />
          <line x1="14" y1="2" x2="14" y2="4" />
        </svg>
      );
    case "return":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <circle cx="12" cy="5" r="3" />
          <line x1="12" y1="8" x2="12" y2="22" />
          <line x1="9" y1="11" x2="15" y2="11" />
          <path d="M5 15a7 7 0 0 0 14 0" />
        </svg>
      );
    default:
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
        >
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
  }
}

export function PackingSection({
  shop,
  trip,
  rentalFit,
  day,
  days,
  multiDay,
  siteBottomTimes,
  legTravelTimes,
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
  /** All meeting windows when the departure repeats its dock rhythm. */
  days?: { startsAt: Date; endsAt: Date }[];
  /** Whether this departure meets on more than one day — the rhythm repeats. */
  multiDay: boolean;
  /**
   * Each planned dive's own time in the water, dive 1 first, where the site it
   * visits names one. Absent entries fall back to the shop's own figure — see
   * `SiteBottomTimes`.
   */
  siteBottomTimes?: SiteBottomTimes;
  /**
   * Each leg of this departure's run, dive 1 first: dock to the first site,
   * then site to site. Absent entries stay on the shop's own ride-out figure —
   * see `LegTravelTimes`.
   */
  legTravelTimes?: LegTravelTimes;
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
  const rhythmDays = days?.length ? days : [day ?? trip];
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
      {trip.course ? null : (
        <>
          <h3 className="mt-6 font-semibold">{t("trip.dockDayRhythm")}</h3>
          <div className="mt-3 space-y-5">
            {rhythmDays.map((window, dayIndex) => {
              const baseDives = Math.floor(trip.plannedDives / rhythmDays.length);
              const divesThisDay =
                baseDives + (dayIndex < trip.plannedDives % rhythmDays.length ? 1 : 0);
              return (
                <div key={`${window.startsAt.toISOString()}-${window.endsAt.toISOString()}`}>
                  {multiDay ? (
                    <h4 className="font-medium">
                      {t("trip.dockDayLabel", { number: dayIndex + 1 })}
                    </h4>
                  ) : null}
                  <ol className="relative mt-4 space-y-0 text-sm">
                    {(() => {
                      const timeline = dockDayTimeline(
                        window.startsAt,
                        shop,
                        window.endsAt,
                        divesThisDay,
                        siteBottomTimes,
                        legTravelTimes,
                      );
                      return timeline.map((entry, entryIndex) => (
                        <li
                          key={`${entry.step}-${entry.number ?? 0}`}
                          className="relative flex items-start pl-8 pb-5 last:pb-0"
                        >
                          {entryIndex < timeline.length - 1 ? (
                            <div
                              className="absolute left-[11px] top-6 bottom-0 w-0.5 bg-border"
                              aria-hidden="true"
                            />
                          ) : null}
                          <div className="absolute left-0 top-0.5 flex size-6 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-xs z-10">
                            <StepIcon step={entry.step} className="size-3.5" />
                          </div>
                          <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-4">
                            <span className="font-semibold tabular-nums text-foreground text-sm sm:w-20 sm:shrink-0">
                              {entry.at.toLocaleTimeString(locale, {
                                hour: "numeric",
                                minute: "2-digit",
                                timeZone: shop.timezone,
                              })}
                            </span>
                            <span className="text-muted text-sm leading-normal">
                              {t(`trip.timeline.${entry.step}`, { number: entry.number ?? 1 })}
                            </span>
                          </div>
                        </li>
                      ));
                    })()}
                  </ol>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
