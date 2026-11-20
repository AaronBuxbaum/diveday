import Link from "next/link";
import type { ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { StatusMark } from "@/components/ui/StatusMark";
import type { TripMoney } from "@/features/trip-money";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, formatTime, formatTimeRange } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { shopPath } from "@/lib/staff-notices";
import { startIncidentReportAction } from "../../incidents/actions";
import { diveLogHash } from "../TripDiveRecord";
import type { WaterStanding } from "../water-standing";
import type { CloseOutItem } from "../wrapped-close-out";
import type { WrappedRecords } from "../wrapped-records";

const LINK = buttonClass({ variant: "link", size: "sm", flush: true });
/** The first thing left carries the one primary; the rest are secondary (finding 5). */
const FIX = (first: boolean) =>
  buttonClass({ variant: first ? "primary" : "secondary", size: "sm", className: "shrink-0" });

type Words = { locale: string; timeZone: string; t: StaffTranslator };

function listOf(locale: string, items: readonly string[]): string {
  return cachedListFormat(locale, { style: "long", type: "conjunction" }).format(items);
}

/** **Close out**: each thing left, with the one door that closes it. Nothing when none is. */
export function CloseOutCard({
  items,
  shopSlug,
  tripId,
  locale,
  t,
}: { items: readonly CloseOutItem[]; shopSlug: string; tripId: string } & Omit<Words, "timeZone">) {
  if (items.length === 0) return null;
  const trip = (...rest: string[]) => shopPath(shopSlug, "trips", tripId, ...rest);
  const row = (
    item: CloseOutItem,
  ): { title: string; sub: string | null; href: string; fix: string } => {
    switch (item.kind) {
      case "rollCall":
        return {
          title: t(
            item.dive > 0
              ? "trips.clock.wrapped.rollCallOpen"
              : "trips.clock.wrapped.aboardNotBack",
          ),
          sub: listOf(locale, item.names),
          href: `${trip("manifest")}?checkpoint=${item.dive > 0 ? `after_dive_${item.dive}` : "departure"}`,
          fix: t("trips.clock.water.openRollCall"),
        };
      case "noRollCall":
        return {
          title: t("trips.clock.wrapped.noRollCall"),
          sub: null,
          href: trip("manifest"),
          fix: t("trips.clock.water.openRollCall"),
        };
      case "flySafe":
        // Resolved on Today, where the shop-wide list and its taps are.
        return {
          title: t("trips.flySafeFollowUp.heading"),
          sub: listOf(locale, item.names),
          href: `${shopPath(shopSlug)}#fly-safe-follow-up`,
          fix: t("trips.clock.wrapped.followUp"),
        };
      case "rentals":
        return {
          title: t("trips.clock.wrapped.rentals", { count: item.count }),
          sub: listOf(locale, item.names),
          href: `${trip("prep")}#back-from-boat-heading`,
          fix: t("trips.clock.wrapped.markReturned"),
        };
      case "noLog":
        return {
          title: t("trips.clock.wrapped.noLog", { dive: item.dive }),
          sub: item.site,
          href: diveLogHash(item.dive),
          fix: t("trips.clock.wrapped.logDive", { dive: item.dive }),
        };
      case "draftReport":
        return {
          title: t("trips.clock.wrapped.draftReport"),
          sub: t("trips.clock.wrapped.writtenBy", { name: item.by }),
          href: trip("incidents", item.id),
          fix: t("trips.clock.wrapped.finishReport"),
        };
    }
  };
  return (
    <ul
      data-close-out=""
      className={`${sectionCardClass({ padding: "none" })} divide-y divide-border`}
    >
      {items.map((item, index) => {
        const { title, sub, href, fix } = row(item);
        return (
          <li
            key={
              item.kind === "noLog"
                ? `log-${item.dive}`
                : item.kind === "draftReport"
                  ? item.id
                  : item.kind
            }
            className="flex items-start gap-3 px-4 py-3 sm:items-center sm:px-6"
          >
            <StatusMark variant="danger" size="md" className="mt-0.5 sm:mt-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{title}</p>
              {sub ? <p className="text-sm text-muted [overflow-wrap:anywhere]">{sub}</p> : null}
            </div>
            <Link href={href} className={FIX(index === 0)}>
              {fix}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

type IncidentLines = {
  /** The reports this viewer may read (`listTripIncidentReports`). */
  reports: readonly { id: string; status: string; createdByName: string }[];
  /** Whether this viewer may start one: the crew aboard, owners and managers. */
  mayStart: boolean;
};

/** The incident reports said once: each one's door, or None, and one quiet "Report one". */
function incidentValue(
  { reports }: IncidentLines,
  { shopSlug, tripId, t }: { shopSlug: string; tripId: string; t: StaffTranslator },
): ReactNode {
  if (reports.length === 0) return t("trips.clock.wrapped.none");
  return (
    <span className="flex flex-col items-start gap-1">
      {reports.map((report) => (
        <Link
          key={report.id}
          href={shopPath(shopSlug, "trips", tripId, "incidents", report.id)}
          className={LINK}
        >
          {t(
            report.status === "filed"
              ? "trips.clock.wrapped.reportFiled"
              : "trips.clock.wrapped.reportDraft",
            {
              name: report.createdByName,
            },
          )}
        </Link>
      ))}
    </span>
  );
}

/** "Report one": the only door on the departure that starts an incident report. */
function ReportOne({
  shopSlug,
  tripId,
  t,
}: {
  shopSlug: string;
  tripId: string;
  t: StaffTranslator;
}) {
  return (
    <form action={startIncidentReportAction.bind(null, shopSlug, tripId)}>
      <SubmitButton pendingLabel={t("words.busy.opening")} className={LINK}>
        {t("trips.clock.wrapped.reportOne")}
      </SubmitButton>
    </form>
  );
}

/**
 * **The incidents row, said once** ("Incidents · None · Report one"): On the
 * water, and Wrapped up when the trip never sailed and has no dives to tell,
 * since one can still happen at the dock. Nothing for a viewer who may neither
 * read a report nor start one.
 */
export function IncidentsLine({
  incidents,
  shopSlug,
  tripId,
  t,
}: {
  incidents: IncidentLines;
  shopSlug: string;
  tripId: string;
  t: StaffTranslator;
}) {
  if (!incidents.mayStart && incidents.reports.length === 0) return null;
  return (
    <div
      id="incidents"
      className="grid scroll-mt-24 grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-x-4 sm:grid-cols-[9rem_minmax(0,1fr)_auto]"
    >
      <span className="text-muted">{t("trips.clock.wrapped.incidents")}</span>
      <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">
        {incidentValue(incidents, { shopSlug, tripId, t })}
      </span>
      <span>
        {incidents.mayStart ? <ReportOne shopSlug={shopSlug} tripId={tripId} t={t} /> : null}
      </span>
    </div>
  );
}

/**
 * **What happened**, one block (design review of the final screens, finding
 * 4): each dive as recorded (site, times, deepest, when its count closed),
 * opening in place to its log once its count has begun; then the incident
 * reports, no-shows and turn-aways. A dive nobody counted says "Not counted",
 * one nobody logged "Not logged"; neither is guessed. Last, a short row for
 * what the crew saw and what was left aboard, each opening its record
 * (issue #4683).
 */
export function WhatHappenedCard({
  standing,
  depth,
  logRow,
  incidents,
  noShows,
  turnedAway,
  print,
  records,
  shopSlug,
  tripId,
  locale,
  timeZone,
  t,
}: {
  standing: WaterStanding;
  depth: (meters: number) => string;
  /** The dive's row opening to its log, or null for a dive with no count begun. */
  logRow: (dive: number, row: ReactNode) => ReactNode;
  incidents: IncidentLines;
  noShows: readonly string[];
  turnedAway: readonly string[];
  print: ReactNode;
  /** What was seen and left aboard (`wrappedRecords`); absent, no rows. */
  records?: WrappedRecords;
  shopSlug: string;
  tripId: string;
} & Words) {
  const none = t("trips.clock.wrapped.none");
  const rows: {
    key: string;
    label: string;
    value: ReactNode;
    detail?: string | null;
    action?: ReactNode;
    id?: string;
  }[] = [];
  const dives: { dive: number; row: (typeof rows)[number] }[] = [];
  for (const stop of standing.timeline) {
    if (stop.kind !== "dive") continue;
    const { logged, count } = stop;
    const value = [
      stop.site,
      logged?.enteredAt && logged.exitedAt
        ? formatTimeRange(logged.enteredAt, logged.exitedAt, locale, timeZone)
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const detail = [
      count ? null : t("trips.clock.wrapped.notCounted"),
      logged || !value ? null : t("trips.clock.wrapped.notLogged"),
      logged?.maxDepthMeters != null
        ? t("trips.clock.wrapped.deepest", { depth: depth(logged.maxDepthMeters) })
        : null,
      count?.complete && count.at
        ? t("trips.clock.wrapped.countedBack", { time: formatTime(count.at, locale, timeZone) })
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    dives.push({
      dive: stop.dive,
      row: {
        key: `dive-${stop.dive}`,
        label: t("trips.clock.water.dive", { dive: stop.dive }),
        value: value || (logged ? none : t("trips.clock.wrapped.notLogged")),
        detail: detail || null,
      },
    });
  }
  if (incidents.mayStart || incidents.reports.length > 0) {
    rows.push({
      key: "incidents",
      id: "incidents",
      label: t("trips.clock.wrapped.incidents"),
      value: incidentValue(incidents, { shopSlug, tripId, t }),
      action: incidents.mayStart ? <ReportOne shopSlug={shopSlug} tripId={tripId} t={t} /> : null,
    });
  }
  rows.push({
    key: "no-shows",
    label: t("trips.clock.wrapped.noShows"),
    value: noShows.length > 0 ? listOf(locale, noShows) : none,
  });
  if (turnedAway.length > 0) {
    rows.push({
      key: "turned-away",
      label: t("trips.clock.wrapped.turnedAway"),
      value: listOf(locale, turnedAway),
    });
  }
  if (records?.seen) {
    const { dive } = records.seen;
    rows.push({
      key: "seen",
      label: t("trips.clock.wrapped.seen"),
      value: t("trips.clock.wrapped.species", { count: records.seen.species }),
      action: (
        <Link
          href={`${shopPath(shopSlug, "trips", tripId, "manifest")}${dive ? `?checkpoint=after_dive_${dive}` : ""}`}
          className={LINK}
        >
          {t("trips.clock.water.openRollCall")}
        </Link>
      ),
    });
  }
  if (records?.leftAboard) {
    rows.push({
      key: "left-aboard",
      label: t("desk.lostFound.heading"),
      value: t("trips.clock.wrapped.items", { count: records.leftAboard.count }),
      // Under More, which opens for it.
      action: (
        <a href="#found-aboard" className={LINK}>
          {t("trips.about.view")}
        </a>
      ),
    });
  }
  const GRID =
    "grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-x-4 sm:grid-cols-[9rem_minmax(0,1fr)_auto]";
  const cells = (row: (typeof rows)[number]) => (
    <>
      <span className="text-muted">{row.label}</span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="font-semibold">{row.value}</span>
        {row.detail ? <span className="block text-sm text-muted">{row.detail}</span> : null}
      </span>
      <span>{row.action}</span>
    </>
  );
  return (
    <section
      aria-labelledby="what-happened-heading"
      data-what-happened=""
      className={sectionCardClass({ padding: "none" })}
    >
      <div className="flex items-baseline justify-between gap-4 px-4 pt-4 sm:px-6">
        <h2 id="what-happened-heading" className="font-semibold">
          {t("trips.clock.wrapped.whatHappened")}
        </h2>
        {print}
      </div>
      <ul className="mt-2 divide-y divide-border">
        {dives.map(({ dive, row }) => {
          // A dive whose count has begun opens in place to its log.
          const opens = logRow(dive, <span className={GRID}>{cells(row)}</span>);
          return (
            <li key={row.key} data-dive-row={dive}>
              {opens ?? <div className={`${GRID} px-4 py-3 sm:px-6`}>{cells(row)}</div>}
            </li>
          );
        })}
        {rows.map((row) => (
          <li key={row.key} id={row.id} className={`${GRID} scroll-mt-24 px-4 py-3 sm:px-6`}>
            {cells(row)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * **Money**: what this departure collected, what of it was rental gear, and
 * what its seats still owe, from the payments already recorded
 * (`getTripMoney`); on a cancelled trip, only what was collected. For whoever
 * may read the shop's reports.
 */
export function MoneyCard({
  money,
  cancelled,
  locale,
  t,
}: { money: TripMoney; cancelled: boolean } & Omit<Words, "timeZone">) {
  const amount = (cents: number) => formatMoneyCents(cents, money.currency, locale);
  // A trip that never sailed owes the shop nothing and rented nothing: what
  // came in is what its refunds are about (the call-off record holds them).
  const rows = [
    {
      key: "collected",
      label: t("trips.clock.wrapped.collected"),
      value: amount(money.collectedCents),
    },
    {
      key: "rentals",
      label: t("trips.clock.wrapped.rentalsLabel"),
      value:
        money.rentalGuests > 0
          ? t("trips.clock.wrapped.rentalGuests", {
              amount: amount(money.rentalCents),
              count: money.rentalGuests,
            })
          : t("trips.clock.wrapped.none"),
    },
    {
      key: "owed",
      label: t("trips.clock.wrapped.owed"),
      value: money.owedCents > 0 ? amount(money.owedCents) : t("trips.clock.wrapped.nothingOwed"),
    },
  ].filter((row) => !cancelled || row.key === "collected");
  return (
    <section
      aria-labelledby="money-heading"
      data-money=""
      className={sectionCardClass({ padding: "none" })}
    >
      <h2 id="money-heading" className="px-4 pt-4 font-semibold sm:px-6">
        {t("trips.clock.wrapped.money")}
      </h2>
      <dl className="mt-2 divide-y divide-border">
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:px-6"
          >
            <dt className="text-muted">{row.label}</dt>
            <dd className="min-w-0 font-semibold tabular-nums [overflow-wrap:anywhere]">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {money.otherCurrencySeats > 0 ? (
        <p className="px-4 pb-4 text-sm text-muted sm:px-6">
          {t("trips.clock.wrapped.otherCurrency", { count: money.otherCurrencySeats })}
        </p>
      ) : null}
    </section>
  );
}
