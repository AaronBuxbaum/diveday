import { GroupLabel } from "@/components/ui/ledger";
import { FIGURE_CLASS } from "@/components/ui/typography";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { DayTakings as DayTakingsReading } from "@/lib/closeout";
import { formatReportMoney } from "@/lib/reporting";

/**
 * **What today made** — the evening's one money reading, above the closing
 * block (issue #1930; ADR 20260919-one-idea, decision I · Tide: "a boat is a
 * moment on the day … and money is what the day made").
 *
 * **A reading, not an act, and that is why it sits here.** `ClosingBlock`'s
 * charter is two things and nothing else — the leftovers, each with its own
 * Dismiss, and the one closing act — and its "nothing else" is load-bearing
 * against re-asking a decision or captioning an act. A figure a shop reads on
 * its way past is neither, so it stands beside that component rather than
 * inside it, under the same `assembleEveningClose(...).closing` condition, and
 * ADR 20260827-clearwater-surface-language decision 4 and H-62 stand
 * unamended. Aaron decided the placement in session on 2026-09-20; the two
 * alternatives — amending the charter by ADR, and a door to `/reports`
 * filtered to the day rather than a figure — are recorded on the issue.
 *
 * **It links nowhere.** The door was the option that was not taken; a reading
 * that also offered a destination would quietly reintroduce it, and the
 * evening already ends on one primary act.
 *
 * Three things decide whether this renders at all, and every one of them
 * happens before the component:
 *
 * 1. The day is closing — every departure of the shop day settled.
 * 2. The reader passes `canPersonViewShopReports`, checked against live role
 *    rows rather than the JWT, so a demoted manager loses the figure at once.
 *    A captain sees the evening exactly as they did before, with **nothing**
 *    in this slot — the same absence `canOpenLog` already spends on this
 *    surface for the incident log. A line saying "you may not read this"
 *    would tell the crew that a number exists and is being withheld, which is
 *    worse than the silence it replaces.
 * 3. The day has money in it (`dayTakings` answers null otherwise).
 *
 * Tips print as their own sentence beneath the figure and are never added to
 * it: a tip is 100% the shop's, on its own Stripe session, outside the
 * booking payment gate, and the month's revenue card keeps the two apart for
 * that reason. The day has to tell the same story the month does.
 *
 * **It rounds to whole units, and that is the answer rather than the
 * default.** `formatReportMoney` drops the minor units, so a day of $1,239.50
 * reads "$1,240" — chosen for a month's KPI headline, and inherited here on
 * purpose. This is a reading of the same figure `/reports` prints, and a
 * shop that saw "$1,239.50" tonight and "$1,240" tomorrow morning would have
 * two numbers to reconcile where there is one. It is not a till count and
 * never claims to be; the cent-exact ledger is Orders.
 */
export function DayTakings({
  takings,
  currency,
  locale,
  t,
}: {
  takings: DayTakingsReading;
  currency: string;
  locale: string;
  t: StaffTranslator;
}) {
  return (
    <section aria-labelledby="day-takings-label">
      <GroupLabel as="h2" id="day-takings-label">
        {t("closeout.takings.heading")}
      </GroupLabel>
      {/* The figure leads its own block, so it takes the ordinary leading
          rung rather than the month's headline one: the home's idea is the
          day's work, and the takings are a fact the day carries, not the
          number this page exists to show. */}
      <p className={`mt-2 ${FIGURE_CLASS}`}>
        {formatReportMoney(takings.revenueCents, currency, locale)}
      </p>
      {/* Zero tips render no clause at all rather than "$0 in tips", which is
          the same restraint that keeps a cash shop from meeting this whole
          section every night. */}
      {takings.tipsCents !== 0 ? (
        <p className="mt-1 text-sm text-muted tabular-nums">
          {t("closeout.takings.tips", {
            amount: formatReportMoney(takings.tipsCents, currency, locale),
          })}
        </p>
      ) : null}
      {/* Money inside the figure that Stripe never confirmed, named where the
          figure is read — the month's revenue card says the same thing, and a
          shop mid-migration from another system is exactly the reader who
          needs it said twice. */}
      {takings.importedRecordCount > 0 ? (
        <p className="mt-1 text-sm text-muted">
          {t("closeout.takings.imported", { count: takings.importedRecordCount })}
        </p>
      ) : null}
    </section>
  );
}
