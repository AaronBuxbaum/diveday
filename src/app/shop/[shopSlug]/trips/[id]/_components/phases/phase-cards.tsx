import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import type { GearToPack } from "@/features/trips/trip-prep";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { DepthUnit } from "@/lib/depth-units";
import { formatTime } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import type { AutomatedMarineForecast } from "@/lib/marine-forecast";
import type { TemperatureUnit } from "@/lib/temperature-units";
import { ConditionsOutlook } from "../ConditionsSection";

const LINK = buttonClass({ variant: "link", size: "sm", flush: true });
const HEADING = "font-semibold";

/** "Sal, Ana and Joe", in the reader's language. */
function listOf(locale: string, items: readonly string[]): string {
  return cachedListFormat(locale, { style: "long", type: "conjunction" }).format(items);
}

/** A labelled list of short facts: the label column, then the value. */
function FactList({ rows }: { rows: { key: string; label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2 text-sm">
      {rows.map((row) => (
        <div key={row.key} className="contents">
          <dt className="text-muted">{row.label}</dt>
          <dd className="[overflow-wrap:anywhere]">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * **The trip's facts, while it fills** (ADR 20261117-trip-page-clock, Filling):
 * crew, plan, price and who can book, one quiet line under the sentence. Each
 * value is the door to its own section of Edit trip; nothing is edited here.
 * Facts only; what is missing for the day is the fix list's, from Getting ready.
 */
export function TripFactsLine({
  crew,
  plan,
  price,
  whoCanBook,
  editHref,
  locale,
  t,
}: {
  crew: string[];
  plan: string[];
  price: string | null;
  whoCanBook: string;
  /** Edit trip, at a section's anchor. */
  editHref: (section: string) => string;
  locale: string;
  t: StaffTranslator;
}) {
  const notSet = t("trips.clock.filling.notSet");
  const facts = [
    { section: "crew", label: t("trips.clock.filling.crew"), value: listOf(locale, crew) },
    { section: "dives", label: t("trips.clock.filling.plan"), value: listOf(locale, plan) },
    { section: "about", label: t("trips.clock.filling.price"), value: price ?? "" },
    {
      section: "requirements",
      label: t("trips.clock.filling.whoCanBook"),
      value: whoCanBook,
    },
  ];
  return (
    <dl data-trip-facts className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {facts.map((fact) => (
        <div key={fact.section} className="flex min-w-0 gap-x-1.5">
          <dt className="shrink-0 text-muted">{fact.label}</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">
            <Link
              href={editHref(fact.section)}
              aria-label={`${t("trips.clock.filling.edit")} · ${fact.label}: ${fact.value || notSet}`}
              className={`underline decoration-border underline-offset-4 hover:decoration-foreground ${fact.value ? "" : "text-muted"}`}
            >
              {fact.value || notSet}
            </Link>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * **Gear to pack** (Getting ready): the Gear page's own list read as four
 * lines, with the Pull list one tap away. Buddy teams sit here when the shop
 * runs them.
 */
export function GearToPackCard({
  gear,
  prepHref,
  buddyTeamsHref,
  locale,
  t,
}: {
  gear: GearToPack;
  prepHref: string;
  /** The buddy teams, when the shop has the feature on. */
  buddyTeamsHref: string | null;
  locale: string;
  t: StaffTranslator;
}) {
  const rows: { key: string; label: string; value: ReactNode }[] = [
    {
      key: "tanks",
      label: t("trips.clock.ready.tanks"),
      value:
        gear.tanks.nitrox > 0
          ? t("trips.clock.ready.tanksMixed", { air: gear.tanks.air, nitrox: gear.tanks.nitrox })
          : t("trips.clock.ready.tanksAir", { count: gear.tanks.air }),
    },
    {
      key: "rentals",
      label: t("trips.clock.ready.rentalSets"),
      value:
        gear.rentals.total === 0 ? (
          t("trips.clock.ready.noRentals")
        ) : (
          <>
            {t("trips.clock.ready.sized", { sized: gear.rentals.sized, total: gear.rentals.total })}
            {gear.rentals.fitAtCheckIn.length > 0 ? (
              <span className="block text-warning-strong">
                {t("trips.clock.ready.fitAtCheckIn", {
                  names: listOf(locale, gear.rentals.fitAtCheckIn),
                })}
              </span>
            ) : null}
          </>
        ),
    },
  ];
  if (gear.weights) {
    rows.push({
      key: "weights",
      label: t("trips.clock.ready.weights"),
      value:
        gear.weights.unsaid.length > 0 ? (
          <span className="text-warning-strong">
            {t("trips.clock.ready.weightsUnsaid", { names: listOf(locale, gear.weights.unsaid) })}
          </span>
        ) : (
          t("trips.clock.ready.weightsSaid")
        ),
    });
  }
  if (gear.lunch !== null) {
    rows.push({
      key: "lunch",
      label: t("trips.clock.ready.lunch"),
      value: t("trips.clock.ready.lunchCount", { count: gear.lunch }),
    });
  }
  if (gear.pickups > 0) {
    rows.push({
      key: "pickups",
      label: t("trips.clock.ready.pickups"),
      value: t("trips.clock.ready.pickupsCount", { count: gear.pickups }),
    });
  }
  return (
    <section
      aria-labelledby="gear-to-pack-heading"
      data-gear-to-pack
      className={sectionCardClass({ className: "space-y-3" })}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id="gear-to-pack-heading" className={HEADING}>
          {t("trips.clock.ready.gearHeading")}
        </h2>
        <span className="flex flex-wrap gap-x-4">
          {buddyTeamsHref ? (
            <Link href={buddyTeamsHref} className={LINK}>
              {t("trips.clock.ready.buddyTeams")}
            </Link>
          ) : null}
          <Link href={prepHref} className={LINK}>
            {t("trips.clock.ready.pullList")}
          </Link>
        </span>
      </div>
      <FactList rows={rows} />
    </section>
  );
}

/**
 * **Tomorrow's water** (Getting ready): the model's read and the tide, the same
 * `ConditionsOutlook` Edit trip shows, and the door to call the trip off for
 * weather. Informs; gates nothing. Says so plainly when no provider answered.
 */
export async function TomorrowsWaterCard({
  automatedForecast,
  tideLines,
  callOffHref,
  locale,
  timezone,
  temperatureUnit,
  depthUnit,
  t,
}: {
  automatedForecast: Promise<AutomatedMarineForecast | null>;
  tideLines: Promise<{ site: string; text: string; station?: string | null }[]>;
  /** Null on a trip already called off. */
  callOffHref: string | null;
  locale: string;
  timezone: string;
  temperatureUnit: TemperatureUnit;
  depthUnit: DepthUnit;
  t: StaffTranslator;
}) {
  const [forecast, lines] = await Promise.all([automatedForecast, tideLines]);
  const answered = Boolean(forecast) || lines.length > 0;
  return (
    <section
      aria-labelledby="tomorrows-water-heading"
      data-tomorrows-water
      className={sectionCardClass({ className: "space-y-2" })}
    >
      <h2 id="tomorrows-water-heading" className={HEADING}>
        {t("trips.clock.ready.waterHeading")}
      </h2>
      {answered ? (
        <ConditionsOutlook
          locale={locale}
          timezone={timezone}
          temperatureUnit={temperatureUnit}
          depthUnit={depthUnit}
          automatedForecast={forecast}
          tideLines={lines}
        />
      ) : (
        <p className="text-sm text-muted">{t("trips.clock.ready.noForecast")}</p>
      )}
      {callOffHref ? (
        <Link
          href={callOffHref}
          className={buttonClass({ variant: "link", size: "sm", flush: true })}
        >
          {t("trips.clock.ready.callOff")}
        </Link>
      ) : null}
    </section>
  );
}

/**
 * **Check-in's quiet line** (drawing `22-clock-checkin`): gear, crew, the
 * water, and what comes next, one line each at the foot, nothing to do.
 */
export function CheckInQuietLine({
  rentalSets,
  crew,
  water,
  rollCall,
  t,
}: {
  rentalSets: number;
  crew: string[];
  water: string | null;
  rollCall: { at: Date; href: string; locale: string; timeZone: string };
  t: StaffTranslator;
}) {
  const rows: { key: string; label: string; value: ReactNode }[] = [
    {
      key: "gear",
      label: t("trips.clock.quiet.gear"),
      value:
        rentalSets > 0
          ? t("trips.clock.quiet.sets", { count: rentalSets })
          : t("trips.clock.quiet.noSets"),
    },
    {
      key: "crew",
      label: t("trips.clock.quiet.crew"),
      value: crew.length > 0 ? listOf(rollCall.locale, crew) : t("trips.clock.quiet.noCrew"),
    },
  ];
  if (water) rows.push({ key: "water", label: t("trips.clock.quiet.water"), value: water });
  rows.push({
    key: "next",
    label: t("trips.clock.quiet.next"),
    value: (
      <Link href={rollCall.href} className={LINK}>
        {t("trips.clock.quiet.rollCallAt", {
          time: formatTime(rollCall.at, rollCall.locale, rollCall.timeZone),
        })}
      </Link>
    ),
  });
  return (
    <section data-quiet-line className="border-t border-border pt-4">
      <FactList rows={rows} />
    </section>
  );
}
