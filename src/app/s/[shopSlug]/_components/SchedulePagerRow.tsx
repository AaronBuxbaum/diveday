import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import type { DiverTranslator } from "@/i18n/messages";
import type { schedulePagerHrefs } from "./schedule-view";
import { WEEK_LEDGER_FOLLOWER_CLASS } from "./WeekLedger";

/**
 * The public schedule's pager row: earlier, later, and back to the next
 * departures. The page decides whether it shows at all (never in the frame);
 * under the week's list it takes `WEEK_LEDGER_FOLLOWER_CLASS`, under an empty
 * state its own margin.
 */
export function SchedulePagerRow({
  pager,
  showsBackToNext,
  followsWeekLedger,
  t,
}: {
  pager: ReturnType<typeof schedulePagerHrefs>;
  /** The view is paged forward or pinned to a month. */
  showsBackToNext: boolean;
  followsWeekLedger: boolean;
  t: DiverTranslator;
}) {
  return (
    <div
      className={`print:hidden flex flex-wrap items-center gap-3 ${followsWeekLedger ? WEEK_LEDGER_FOLLOWER_CLASS : "mt-5"}`}
    >
      {pager.earlier ? (
        <Link href={pager.earlier} scroll={false} className={buttonClass({ variant: "secondary" })}>
          {t("schedule.showEarlier")}
        </Link>
      ) : null}
      {pager.later ? (
        <Link href={pager.later} scroll={false} className={buttonClass({ variant: "secondary" })}>
          {t("schedule.showLater")}
        </Link>
      ) : null}
      {showsBackToNext ? (
        <Link
          href={pager.backToNext}
          scroll={false}
          className="text-sm font-medium text-primary hover:underline"
        >
          {t("schedule.backToNext")}
        </Link>
      ) : null}
    </div>
  );
}
