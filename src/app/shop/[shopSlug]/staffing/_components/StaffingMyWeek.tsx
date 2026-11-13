import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { GroupLabel } from "@/components/ui/group-label";
import { LedgerRow } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import type { AvailabilityBlock } from "@/lib/crew-requests";
import { formatCalendarDateRange, formatShortDate, formatTimeRange } from "@/lib/format";

type MyShift = { id: string; startsAt: Date; endsAt: Date; note: string | null };

type Entry =
  | { kind: "shift"; sort: string; shift: MyShift }
  | { kind: "away"; sort: string; block: AvailabilityBlock };

/**
 * **Your own week on the Shifts tab**: the shifts and days off the reader has, soonest first, each
 * with its Remove, and the two doors that add more. Everyone else's are on the Crew week.
 */
export function StaffingMyWeek({
  shifts,
  blocks,
  locale,
  timeZone,
  canManage,
  t,
  deleteShiftAction,
  deleteAwayAction,
}: {
  shifts: readonly MyShift[];
  blocks: readonly AvailabilityBlock[];
  locale: string;
  timeZone: string;
  canManage: boolean;
  t: StaffTranslator;
  deleteShiftAction: (formData: FormData) => void;
  deleteAwayAction: (formData: FormData) => void;
}) {
  const entries: Entry[] = [
    ...shifts.map((shift) => ({
      kind: "shift" as const,
      sort: `${calendarDateInTimezone(shift.startsAt, timeZone)}-${shift.startsAt.toISOString()}`,
      shift,
    })),
    ...blocks.map((block) => ({
      kind: "away" as const,
      sort: `${block.startsOn}-~`,
      block,
    })),
  ].sort((a, b) => a.sort.localeCompare(b.sort));

  const words = {
    heading: t("staffing.week.shiftsAndAway"),
    empty: t("staffing.week.empty"),
    away: t("staffing.week.away"),
    remove: t("staffing.working.remove"),
    removing: t("words.busy.removing"),
    addShift: t("staffing.addShift.heading"),
    addAway: t("staffing.away.heading"),
  };
  const removeClass = buttonClass({ variant: "ghost", size: "md" });
  return (
    <section aria-labelledby="my-week-heading" className="pt-2 pb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="my-week-heading" className="font-semibold">
          {words.heading}
        </h2>
        <div className="flex flex-wrap gap-2">
          {canManage ? (
            <Link href="#add-shift" className={buttonClass({ variant: "secondary", size: "md" })}>
              {words.addShift}
            </Link>
          ) : null}
          <Link href="#add-away" className={buttonClass({ variant: "secondary", size: "md" })}>
            {words.addAway}
          </Link>
        </div>
      </div>
      {entries.length === 0 ? (
        <LedgerRow as="div">
          <p className="text-base text-muted">{words.empty}</p>
        </LedgerRow>
      ) : (
        <ul>
          {entries.map((entry) =>
            entry.kind === "shift" ? (
              <LedgerRow key={entry.shift.id} trailing={null}>
                <div className="flex min-h-11 items-center justify-between gap-3 text-base">
                  <div className="flex flex-col">
                    <GroupLabel as="p" tone="muted">
                      {formatShortDate(entry.shift.startsAt, locale, timeZone)}
                    </GroupLabel>
                    <span className="font-medium tabular-nums">
                      {formatTimeRange(entry.shift.startsAt, entry.shift.endsAt, locale, timeZone)}
                    </span>
                    {entry.shift.note ? (
                      <span className="text-muted">{entry.shift.note}</span>
                    ) : null}
                  </div>
                  {canManage ? (
                    <form action={deleteShiftAction}>
                      <input type="hidden" name="shiftId" value={entry.shift.id} />
                      <input type="hidden" name="view" value="plan" />
                      <SubmitButton pendingLabel={words.removing} className={removeClass}>
                        {words.remove}
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              </LedgerRow>
            ) : (
              <LedgerRow key={entry.block.id} trailing={null}>
                <div className="flex min-h-11 items-center justify-between gap-3 text-base">
                  <div className="flex flex-col">
                    <GroupLabel as="p" tone="muted">
                      {words.away}
                    </GroupLabel>
                    <span className="font-medium">
                      {formatCalendarDateRange(entry.block.startsOn, entry.block.endsOn, locale)}
                    </span>
                    {entry.block.note ? (
                      <span className="text-muted">{entry.block.note}</span>
                    ) : null}
                  </div>
                  <form action={deleteAwayAction}>
                    <input type="hidden" name="blockId" value={entry.block.id} />
                    <SubmitButton pendingLabel={words.removing} className={removeClass}>
                      {words.remove}
                    </SubmitButton>
                  </form>
                </div>
              </LedgerRow>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
