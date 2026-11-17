import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { StatusMark } from "@/components/ui/StatusMark";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatTime, formatTimeRange } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { shopPath } from "@/lib/staff-notices";
import { diveLogHash } from "../TripDiveRecord";
import type { WaterStanding } from "../water-standing";
import type { CloseOutItem } from "../wrapped-close-out";

const LINK = buttonClass({ variant: "link", size: "sm", flush: true });
const FIX = buttonClass({ variant: "primary", size: "sm", className: "shrink-0" });

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
          title: t("trips.clock.wrapped.rollCallOpen"),
          sub: listOf(locale, item.names),
          href:
            item.dive > 0
              ? `${trip("manifest")}?checkpoint=after_dive_${item.dive}`
              : trip("manifest"),
          fix: t("trips.clock.water.openRollCall"),
        };
      case "noRollCall":
        return {
          title: t("trips.clock.wrapped.noRollCall"),
          sub: null,
          href: trip("manifest"),
          fix: t("trips.clock.water.openRollCall"),
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
      {items.map((item) => {
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
            <Link href={href} className={FIX}>
              {fix}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * **What happened**: each dive as recorded (site, times, deepest, when its
 * count closed), the incident reports, no-shows and turn-aways. A dive
 * nobody counted says "Not counted", one nobody logged "Not logged"; neither
 * is guessed.
 */
export function WhatHappenedCard({
  standing,
  depth,
  reports,
  mayReport,
  noShows,
  turnedAway,
  print,
  locale,
  timeZone,
  t,
}: {
  standing: WaterStanding;
  depth: (meters: number) => string;
  reports: number;
  mayReport: boolean;
  noShows: readonly string[];
  turnedAway: readonly string[];
  print: ReactNode;
} & Words) {
  const none = t("trips.clock.wrapped.none");
  const rows: {
    key: string;
    label: string;
    value: ReactNode;
    detail?: string | null;
    action?: ReactNode;
  }[] = [];
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
    rows.push({
      key: `dive-${stop.dive}`,
      label: t("trips.clock.water.dive", { dive: stop.dive }),
      value: value || (logged ? none : t("trips.clock.wrapped.notLogged")),
      detail: detail || null,
    });
  }
  rows.push({
    key: "incidents",
    label: t("trips.clock.wrapped.incidents"),
    value: reports > 0 ? t("trips.clock.wrapped.reports", { count: reports }) : none,
    action: mayReport ? (
      <Link href="#incidents" className={LINK}>
        {t("trips.clock.wrapped.reportOne")}
      </Link>
    ) : null,
  });
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
      <dl className="mt-2 divide-y divide-border">
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-x-4 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:px-6"
          >
            <dt className="text-muted">{row.label}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-semibold">{row.value}</span>
              {row.detail ? <span className="block text-sm text-muted">{row.detail}</span> : null}
            </dd>
            <dd>{row.action}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
