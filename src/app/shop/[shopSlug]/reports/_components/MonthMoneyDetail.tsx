import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { buttonClass } from "@/components/ui/button";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { MonthMoneyDetail as Detail } from "@/db/report-lines";
import { payoutSentence } from "@/i18n/payout-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { RevenueLine } from "@/lib/report-lines";
import { shopPath } from "@/lib/staff-notices";

/** Each revenue line's name in the staff bundle. */
export const BY_LINE_KEYS = {
  courses: "reports.byLine.courses",
  funDives: "reports.byLine.funDives",
  rentals: "reports.byLine.rentals",
  gearBench: "reports.byLine.gearBench",
  packages: "reports.byLine.packages",
  retail: "reports.byLine.retail",
  imported: "reports.byLine.imported",
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
  shopSlug,
}: {
  report: { partnerReferredSeats: number; buddyReferredSeats: number };
  detail: Detail;
  /** For the door from a referrer's name to their record. */
  shopSlug: string;
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
      {/* **Who brought them** (fifth-loop ideas, item 41): the referring diver
          is the shop's own, so unlike a partner slug it is safe to name, and
          each name is the door to their record, where the owner thanks them. */}
      {detail.buddyReferrers.length > 0 ? (
        <ul className="mt-1 flex flex-wrap justify-end gap-x-4 text-sm text-muted tabular-nums">
          {detail.buddyReferrers.map((referrer) => (
            <li key={referrer.personId}>
              <Link
                href={shopPath(shopSlug, "divers", referrer.personId)}
                className={buttonClass({ variant: "link", size: "sm", flush: true })}
              >
                {t("reports.buddyReferrer", { name: referrer.fullName, count: referrer.friends })}
              </Link>
            </li>
          ))}
        </ul>
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

/**
 * A month with no departures. It is this page's rest state, not news about
 * it: `ShopNotice` is the vocabulary for something that *happened* (a save, a
 * refusal, a permission bounce), and wearing it here made an ordinary quiet
 * January read as a warning. No figure row either — five zeroes over an empty
 * ledger is a month described wrongly, not described quietly
 * (`monthHasActivity`). It can still have taken money, a package, a counter
 * sale, a gear-bench job, so the money by line still shows (issue #2305).
 */
export function QuietMonth({
  title,
  detail,
  t,
  money,
}: {
  title: string;
  detail: Detail;
  t: StaffTranslator;
  money: (cents: number) => string;
}) {
  return (
    <>
      <EmptyState title={title} />
      <MoneyByLine detail={detail} t={t} money={money} />
    </>
  );
}

/**
 * **The quiet lines under the month's figures.**
 *
 * The month's two quiet doors on one line: what Stripe Tax took out of the
 * revenue figure above, and the CSV an owner sends their accountant (issue
 * #700 — the full-shop export is the right tool for a bookkeeper and the wrong
 * one for "just this month"). Tax used to be the sixth tile; it is a footnote
 * to net revenue, not a headline beside it.
 *
 * Then **what left the month's money** (UX review 2026-10-11, item 17):
 * refunds, what discount codes took off, and Stripe's fees. Quiet lines on the
 * tax line's pattern, each only when there is something to say; a month whose
 * payouts never said what their fees were prints no fee line rather than $0.
 */
export function MonthFootnotes({
  taxCents,
  csvHref,
  detail,
  t,
  money,
}: {
  taxCents: number;
  csvHref: string;
  detail: Detail;
  t: StaffTranslator;
  money: (cents: number) => string;
}) {
  const { refundedCents, discountedCents, stripeFeesCents } = detail.out;
  return (
    <>
      <p className="mt-3 text-end text-sm text-muted tabular-nums">
        {t("reports.taxLine", { amount: money(taxCents) })}
        {" · "}
        <a href={csvHref} className="font-medium text-primary hover:underline">
          {t("reports.downloadCsv")}
        </a>
      </p>
      {refundedCents > 0 ? (
        <p className="mt-1 text-end text-sm text-muted tabular-nums">
          {t("reports.moneyOut.refunded", { amount: money(refundedCents) })}
        </p>
      ) : null}
      {discountedCents > 0 ? (
        <p className="mt-1 text-end text-sm text-muted tabular-nums">
          {t("reports.moneyOut.discounted", { amount: money(discountedCents) })}
        </p>
      ) : null}
      {stripeFeesCents !== null && stripeFeesCents !== 0 ? (
        <p className="mt-1 text-end text-sm text-muted tabular-nums">
          {t("reports.moneyOut.fees", { amount: money(stripeFeesCents) })}
        </p>
      ) : null}
    </>
  );
}

/**
 * **What Stripe paid into the bank this month** (ADR
 * 20261012-payouts-reach-diveday): one sentence per payout, the line an owner
 * holds against a bank statement. Read from stored rows only; a month with no
 * payout renders nothing.
 */
export function MonthPayouts({
  detail,
  t,
  locale,
  timeZone,
}: {
  detail: Detail;
  t: StaffTranslator;
  locale: string;
  timeZone: string;
}) {
  if (detail.payouts.length === 0) return null;
  return (
    <section aria-labelledby="reports-payouts" className="mt-10">
      <h2 id="reports-payouts" className={SECTION_TITLE_CLASS}>
        {t("reports.payouts.heading")}
      </h2>
      <ul className="mt-3 max-w-xl text-sm">
        {detail.payouts.map((payout) => (
          <li
            key={payout.id}
            className={`border-t border-border py-2 tabular-nums last:border-b ${
              payout.status === "failed" ? "text-warning-strong" : ""
            }`}
          >
            {payoutSentence(t, payout, { locale, timeZone })}
          </li>
        ))}
      </ul>
    </section>
  );
}
