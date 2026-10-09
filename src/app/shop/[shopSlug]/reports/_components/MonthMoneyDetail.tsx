import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { MonthMoneyDetail as Detail } from "@/db/report-lines";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { RevenueLine } from "@/lib/report-lines";

/** Each revenue line's name in the staff bundle. */
const BY_LINE_KEYS = {
  courses: "reports.byLine.courses",
  funDives: "reports.byLine.funDives",
  rentals: "reports.byLine.rentals",
  gearBench: "reports.byLine.gearBench",
  packages: "reports.byLine.packages",
  retail: "reports.byLine.retail",
} as const satisfies Record<RevenueLine, string>;

/**
 * The month's quiet lines under the figures: partner and buddy arrivals,
 * returning divers, and package dives still owed. Each is a number with no
 * heading over it, and a month with none of a thing renders nothing for it.
 */
export function MonthDetailLines({
  report,
  detail,
  t,
  money,
}: {
  report: { partnerReferredSeats: number; buddyReferredSeats: number };
  detail: Detail;
  t: StaffTranslator;
  money: (cents: number) => string;
}) {
  return (
    <>
      {/* **A count, never the slugs** (issue #1294). This was a "Who sent
          divers" ledger naming each partner; nothing anywhere can tell a
          hotel's slug from one an anonymous visitor invented by editing the
          storefront URL and booking a seat, because `partnerLinkUrl` writes
          no row. So the shop is told the fact — their partner links are
          working, and how hard — without a staff page printing a stranger's
          text as a business fact.

          A quiet line rather than a section, on the tax line's pattern: one
          number does not earn a heading over it, and a month with no
          referred seats renders nothing at all. */}
      {report.partnerReferredSeats > 0 ? (
        <p className="mt-3 text-end text-sm text-muted tabular-nums">
          {t("reports.partnerArrivals", { count: report.partnerReferredSeats })}
        </p>
      ) : null}

      {/* **Where the month's seats came from, when they came from a
          person** (ADR 20260908-one-hand, decision 6, lever W). A quiet
          line on the pattern the partner line above already set. */}
      {report.buddyReferredSeats > 0 ? (
        <p className="mt-1 text-end text-sm text-muted tabular-nums">
          {t("reports.buddySeats", { count: report.buddyReferredSeats })}
        </p>
      ) : null}

      {/* Returning divers and package dives owed (owner decision 2026-10-09). */}
      {detail.divers.returning > 0 ? (
        <p className="mt-1 text-end text-sm text-muted tabular-nums">
          {t("reports.returningDivers", {
            returning: detail.divers.returning,
            total: detail.divers.total,
          })}
        </p>
      ) : null}
      {detail.packageDivesOwed.dives > 0 ? (
        <p className="mt-1 text-end text-sm text-muted tabular-nums">
          {t("reports.packagesOwed", {
            dives: detail.packageDivesOwed.dives,
            amount: money(detail.packageDivesOwed.valueCents),
          })}
        </p>
      ) : null}
    </>
  );
}

/**
 * **Where the money came from** (owner decision 2026-10-09). Plain text, one
 * line per source, no bars: the figures are the facts, and a line that came
 * to nothing is left out rather than read as $0. Its basis is the day the
 * money was paid, not the departures the Revenue figure is anchored to, so it
 * says so under its heading.
 */
export function MoneyByLine({
  detail,
  t,
  money,
}: {
  detail: Detail;
  t: StaffTranslator;
  money: (cents: number) => string;
}) {
  if (detail.lines.length === 0) return null;
  return (
    <section aria-labelledby="reports-by-line" className="mt-10">
      <h2 id="reports-by-line" className={SECTION_TITLE_CLASS}>
        {t("reports.byLine.heading")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("reports.byLine.caption")}</p>
      <dl className="mt-3 max-w-md">
        {detail.lines.map(({ line, cents }) => (
          <div
            key={line}
            className="flex items-baseline justify-between gap-4 border-t border-border py-2 text-sm last:border-b"
          >
            <dt>{t(BY_LINE_KEYS[line])}</dt>
            <dd className="font-medium tabular-nums">{money(cents)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
