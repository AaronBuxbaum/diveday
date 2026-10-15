import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { GroupLabel } from "@/components/ui/group-label";
import { dayLoadOutLine } from "@/i18n/load-out-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { DayLoadOut } from "@/lib/closeout";
import { shopPath } from "@/lib/staff-notices";
import type { EveningReading } from "./DaySpine";
import { DayTakings } from "./DayTakings";

/**
 * **Tomorrow from tonight** (fifth-loop ideas, item 2): once today's boats are
 * settled, what tomorrow needs from the fill station and the gear room
 * tonight, added across every departure, and the printed day for tomorrow.
 *
 * Under the same `closing` condition as the takings beside it: while a boat is
 * out, the evening is not here yet. A count, never a fill log (H-11); each
 * cylinder is still analyzed and signed for at the fill station, which the
 * printed fill list says once.
 */
export function TomorrowFromTonight({
  loadOut,
  shopSlug,
  t,
}: {
  loadOut: DayLoadOut;
  shopSlug: string;
  t: StaffTranslator;
}) {
  return (
    <section aria-labelledby="tomorrow-from-tonight-label">
      <GroupLabel as="h2" id="tomorrow-from-tonight-label">
        {t("closeout.loadOut.heading")}
      </GroupLabel>
      <p className="mt-2 tabular-nums">{dayLoadOutLine(t, loadOut)}</p>
      <Link
        href={`${shopPath(shopSlug, "print")}?day=tomorrow`}
        target="_blank"
        rel="noreferrer"
        className={buttonClass({
          variant: "secondary",
          size: "sm",
          className: "mt-3 print:hidden",
        })}
      >
        {t("closeout.loadOut.print")}
      </Link>
    </section>
  );
}

/**
 * **The evening's two readings, once the day is closing**: what today made
 * (`DayTakings`, for a reader who may read money) and what tomorrow needs from
 * tonight. Fragments, so each stays a section of the spine's own column.
 */
export function EveningReadings({
  evening,
  currency,
  locale,
  timeZone,
  shopSlug,
  t,
}: {
  /** Absent on a spine with no closing state, which says neither. */
  evening: EveningReading | undefined;
  currency: string;
  locale: string;
  timeZone: string;
  shopSlug: string;
  t: StaffTranslator;
}) {
  if (!evening?.close.closing) return null;
  return (
    <>
      {evening.takings ? (
        <DayTakings
          takings={evening.takings}
          currency={currency}
          locale={locale}
          timeZone={timeZone}
          t={t}
        />
      ) : null}
      {evening.close.tomorrow ? (
        <TomorrowFromTonight loadOut={evening.close.tomorrow} shopSlug={shopSlug} t={t} />
      ) : null}
    </>
  );
}
