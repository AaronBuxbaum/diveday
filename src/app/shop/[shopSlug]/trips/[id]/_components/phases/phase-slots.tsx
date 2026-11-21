import { type ReactNode, Suspense } from "react";
import type { TripOverview } from "@/features/trips/trip-overview";
import type { GearToPack } from "@/features/trips/trip-prep";
import { compassText } from "@/i18n/compass-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { DepthUnit } from "@/lib/depth-units";
import { formatMoneyScanned, formatShortDate } from "@/lib/format";
import type { AutomatedMarineForecast } from "@/lib/marine-forecast";
import { shopPath } from "@/lib/staff-notices";
import { type TemperatureUnit, temperatureUnitFor } from "@/lib/temperature-units";
import type { ClockPhase } from "@/lib/trip-clock";
import { admissionDisplay } from "../admission-display";
import { blowoutPath } from "../blowout/blowout-path";
import type { FixListPhase } from "../guest-fix-rows";
import { tripFixes } from "../trip-fixes";
import { CheckInQuietLine, GearToPackCard, TomorrowsWaterCard, TripFactsCard } from "./phase-cards";

type Overview = NonNullable<TripOverview>;
type Water = {
  automatedForecast: Promise<AutomatedMarineForecast | null>;
  tideLines: Promise<{ site: string; text: string; station?: string | null }[]>;
};

/** Who crews it, by name, in the order they were added. */
export function crewNamesOf(overview: Pick<Overview, "staff" | "crew">): string[] {
  const ids = overview.crew.crewIds;
  return ids
    .map((id) => overview.staff.find((entry) => entry.person.id === id)?.person.fullName)
    .filter((name): name is string => Boolean(name));
}

/** The plan as the sites it dives, each once. */
export function planOf(overview: Pick<Overview, "tripDiveList">): string[] {
  return [
    ...new Set(
      overview.tripDiveList
        .map(({ diveSite }) => diveSite?.name)
        .filter((name): name is string => Boolean(name)),
    ),
  ];
}

/**
 * **What each phase adds around the guest list** (ADR 20261117-trip-page-clock),
 * composed here so the route stays thin: the trip-level fixes, Filling's trip
 * facts and next step, Getting ready's settled line, gear and water, and
 * Check-in's quiet line.
 */
export function phaseSlots({
  frame: { shown, current, lookBack, readyFrom, dockBy },
  overview,
  shop,
  shopSlug,
  tripId,
  gearToPack,
  water,
  mayCallOff,
  now,
  locale,
  t,
}: {
  /** Call off is still on offer (`callOffShown`): not cancelled, not sailed, no Home said. */
  mayCallOff: boolean;
  /** The phase shown and the one now, when Getting ready starts, and when the dock call is. */
  frame: {
    shown: ClockPhase;
    current: ClockPhase | null;
    lookBack: boolean;
    readyFrom: Date;
    dockBy: Date;
  };
  overview: Overview;
  shop: {
    timezone: string;
    currency: string;
    depthUnit: DepthUnit;
    temperatureUnit?: TemperatureUnit | null;
    buddyTeamsEnabled?: boolean;
  };
  shopSlug: string;
  tripId: string;
  gearToPack: () => Promise<GearToPack | null>;
  water: Water;
  now: Date;
  locale: string;
  t: StaffTranslator;
}) {
  const { trip, cancelled, requirement } = overview;
  // A cancelled trip has nothing to make ready, and once the boat has left (or
  // when Getting ready or Check-in is looked back on) Check-in's blockers are nobody's
  // work: the guests are only listed, and Roll call says who is where.
  const phase: FixListPhase =
    cancelled || (lookBack && shown !== "filling") || shown === "water" || shown === "wrapped"
      ? "listed"
      : shown;
  const tripPath = shopPath(shopSlug, "trips", tripId);
  const crew = crewNamesOf(overview);
  const plan = planOf(overview);
  const fixes = tripFixes(overview, {
    liveBoatClashes: cancelled ? [] : overview.boatClashes,
    phase,
    shopSlug,
    tripId,
    now,
    t,
  });
  const beside =
    phase === "filling" ? (
      <TripFactsCard
        crew={crew}
        plan={plan}
        price={
          trip.priceCents !== null
            ? formatMoneyScanned(trip.priceCents, shop.currency, locale)
            : null
        }
        whoCanBook={admissionDisplay(trip.course, requirement, overview.siteRequirement, t)}
        editHref={(section) => `${tripPath}?view=edit#${section}`}
        locale={locale}
        t={t}
      />
    ) : null;
  // "Crew and plan are set": said once, folded, when neither is a fix.
  const afterReady =
    phase === "ready" && crew.length > 0 && plan.length > 0 ? (
      <p data-crew-plan-set className="px-4 py-3 text-sm text-muted sm:px-6">
        <span className="font-medium text-foreground">{t("trips.fixList.crewPlanSet")}</span>
        {" · "}
        {crew.join(", ")}
        {" · "}
        {plan.join(", ")}
      </p>
    ) : null;
  const units = {
    locale,
    timezone: shop.timezone,
    temperatureUnit: temperatureUnitFor(shop),
    depthUnit: shop.depthUnit,
  };
  let panel: ReactNode = null;
  // "Next" is about the future, so only Filling seen while it is the phase now says it.
  if (phase === "filling" && current === "filling") {
    panel = (
      <p className="text-sm text-muted">
        <span className="font-medium text-foreground">{t("trips.clock.quiet.next")}</span>
        {" · "}
        {t("trips.clock.quiet.gettingReady", {
          day: formatShortDate(readyFrom, locale, shop.timezone),
        })}
      </p>
    );
  } else if (phase === "ready") {
    panel = (
      <div className="grid gap-6 lg:grid-cols-2">
        <Suspense fallback={null}>
          <GearToPackSlot
            read={gearToPack}
            prepHref={`${tripPath}/prep`}
            buddyTeamsHref={shop.buddyTeamsEnabled ? `${tripPath}?phase=ready&buddies=open` : null}
            locale={locale}
            t={t}
          />
        </Suspense>
        <Suspense fallback={null}>
          <TomorrowsWaterCard
            {...water}
            {...units}
            callOffHref={mayCallOff ? blowoutPath(shopSlug, tripId) : null}
            t={t}
          />
        </Suspense>
      </div>
    );
  } else if (phase === "checkin") {
    panel = (
      <Suspense fallback={null}>
        <QuietLineSlot
          read={gearToPack}
          forecast={water.automatedForecast}
          crew={crew}
          rollCall={{
            at: dockBy,
            href: `${tripPath}/manifest`,
            locale,
            timeZone: shop.timezone,
          }}
          t={t}
        />
      </Suspense>
    );
  }
  return { phase, fixes, beside, afterReady, panel };
}

async function GearToPackSlot({
  read,
  ...card
}: {
  read: () => Promise<GearToPack | null>;
  prepHref: string;
  buddyTeamsHref: string | null;
  locale: string;
  t: StaffTranslator;
}) {
  const gear = await read();
  return gear ? <GearToPackCard gear={gear} {...card} /> : null;
}

/** The forecast's wind, as one short phrase for the quiet line; null when it said none. */
export function windPhrase(
  forecast: AutomatedMarineForecast | null,
  t: StaffTranslator,
): string | null {
  const wind = forecast?.wind;
  if (!wind) return null;
  return t("trips.conditions.automatedWind", {
    speed: wind.speedKnots,
    direction: compassText(t, wind.direction),
    gusts: wind.gustsKnots ?? 0,
    hasGusts: wind.gustsKnots !== null && wind.gustsKnots > wind.speedKnots ? "yes" : "no",
  });
}

async function QuietLineSlot({
  read,
  forecast,
  crew,
  rollCall,
  t,
}: {
  read: () => Promise<GearToPack | null>;
  forecast: Promise<AutomatedMarineForecast | null>;
  crew: string[];
  rollCall: { at: Date; href: string; locale: string; timeZone: string };
  t: StaffTranslator;
}) {
  const [gear, outlook] = await Promise.all([read(), forecast]);
  return (
    <CheckInQuietLine
      rentalSets={gear?.rentals.total ?? 0}
      crew={crew}
      water={windPhrase(outlook, t)}
      rollCall={rollCall}
      t={t}
    />
  );
}
