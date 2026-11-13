import { SubmitButton } from "@/components/SubmitButton";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { GroupLabel } from "@/components/ui/group-label";
import { LedgerRow } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import type { AvailabilityBlock, AwayStatus } from "@/lib/crew-requests";
import { formatCalendarDateRange, formatTimeRange } from "@/lib/format";
import { DayAdd } from "./DayAdd";

type MyShift = { id: string; startsAt: Date; endsAt: Date; note: string | null };
type Day = { date: string; label: string; isToday: boolean };

const STATUS: Record<AwayStatus, { tone: BadgeTone; key: "Pending" | "Approved" | "Declined" }> = {
  pending: { tone: "warning", key: "Pending" },
  approved: { tone: "success", key: "Approved" },
  declined: { tone: "danger", key: "Declined" },
};

/**
 * **Your own week on the Shifts tab**, one row per day, built for the crew member reading it: the
 * shifts you work, the days off you asked for with where each one stands (and the owner's reason
 * when it was declined), and an "Add" on every day that opens right there. Everyone else's week
 * is the Crew tab.
 */
export function StaffingMyWeek({
  days,
  shifts,
  blocks,
  locale,
  timeZone,
  selfId,
  people,
  approvalRequired,
  t,
  createShiftAction,
  saveAwayAction,
  deleteShiftAction,
  deleteAwayAction,
}: {
  days: readonly Day[];
  shifts: readonly MyShift[];
  blocks: readonly AvailabilityBlock[];
  locale: string;
  timeZone: string;
  selfId: string;
  /** Present for a manager: whose shift or day off they are writing. */
  people?: { id: string; name: string }[];
  /** The reader's own days off wait for an owner (the shop asks, and the reader is not one). */
  approvalRequired: boolean;
  t: StaffTranslator;
  createShiftAction: (formData: FormData) => void;
  saveAwayAction: (formData: FormData) => void;
  deleteShiftAction: (formData: FormData) => void;
  deleteAwayAction: (formData: FormData) => void;
}) {
  const removeClass = buttonClass({ variant: "ghost", size: "md" });
  const addWords = {
    add: t("staffing.mine.add"),
    addTo: t.raw("staffing.mine.addTo"),
    tabShift: t("staffing.mine.tabShift"),
    tabDayOff: t("staffing.mine.tabDayOff"),
    person: t("staffing.addShift.person"),
    starts: t("staffing.addShift.starts"),
    ends: t("staffing.addShift.ends"),
    from: t("staffing.away.from"),
    to: t("staffing.away.to"),
    note: t("staffing.addShift.note"),
    notePlaceholder: t("staffing.addShift.notePlaceholder"),
    submitShift: t("staffing.addShift.submit"),
    submitDayOff: t("staffing.away.save"),
    saving: t("words.busy.saving"),
    needsOk: approvalRequired ? t("staffing.mine.needsOk") : null,
  };
  const weekFirst = days[0]?.date ?? "";
  return (
    <section aria-labelledby="my-week-heading" className="pt-2 pb-8">
      <h2 id="my-week-heading" className="mb-3 font-semibold">
        {t("staffing.mine.heading")}
      </h2>
      <ul>
        {days.map((day) => {
          const dayShifts = shifts.filter(
            (shift) => calendarDateInTimezone(shift.startsAt, timeZone) === day.date,
          );
          const dayBlocks = blocks.filter(
            (block) => block.startsOn <= day.date && day.date <= block.endsOn,
          );
          const empty = dayShifts.length === 0 && dayBlocks.length === 0;
          return (
            <LedgerRow key={day.date} stacked trailing={null} pad="lg">
              <div className="flex flex-col gap-2">
                <GroupLabel as="p" tone={day.isToday ? "primary" : "muted"}>
                  {day.label}
                  {day.isToday ? ` · ${t("staffing.week.today")}` : ""}
                </GroupLabel>
                {empty ? (
                  <p className="text-base text-muted">{t("staffing.mine.nothing")}</p>
                ) : null}
                {dayShifts.map((shift) => (
                  <div key={shift.id} className="flex min-h-11 items-center justify-between gap-3">
                    <div className="flex flex-col text-base">
                      <span className="font-medium tabular-nums">
                        {formatTimeRange(shift.startsAt, shift.endsAt, locale, timeZone)}
                      </span>
                      {shift.note ? <span className="text-muted">{shift.note}</span> : null}
                    </div>
                    <form action={deleteShiftAction}>
                      <input type="hidden" name="shiftId" value={shift.id} />
                      <input type="hidden" name="view" value="plan" />
                      <SubmitButton pendingLabel={t("words.busy.removing")} className={removeClass}>
                        {t("staffing.working.remove")}
                      </SubmitButton>
                    </form>
                  </div>
                ))}
                {dayBlocks.map((block) => {
                  const status = STATUS[block.status ?? "approved"];
                  const first = block.startsOn >= weekFirst ? block.startsOn : weekFirst;
                  return (
                    <div
                      key={block.id}
                      className="flex min-h-11 items-center justify-between gap-3"
                    >
                      <div className="flex flex-col items-start gap-1 text-base">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{t("staffing.mine.dayOff")}</span>
                          <Badge tone={status.tone} size="sm">
                            {t(`staffing.mine.status${status.key}`)}
                          </Badge>
                        </span>
                        {block.startsOn !== block.endsOn ? (
                          <span className="text-muted">
                            {formatCalendarDateRange(block.startsOn, block.endsOn, locale)}
                          </span>
                        ) : null}
                        {block.note ? <span className="text-muted">{block.note}</span> : null}
                        {block.decisionNote ? (
                          <span>{t("staffing.mine.reason", { reason: block.decisionNote })}</span>
                        ) : null}
                      </div>
                      {first === day.date ? (
                        <form action={deleteAwayAction}>
                          <input type="hidden" name="blockId" value={block.id} />
                          <SubmitButton
                            pendingLabel={t("words.busy.removing")}
                            className={removeClass}
                          >
                            {t("staffing.working.remove")}
                          </SubmitButton>
                        </form>
                      ) : null}
                    </div>
                  );
                })}
                <DayAdd
                  date={day.date}
                  dayLabel={day.label}
                  selfId={selfId}
                  people={people}
                  createShift={createShiftAction}
                  saveAway={saveAwayAction}
                  words={addWords}
                />
              </div>
            </LedgerRow>
          );
        })}
      </ul>
    </section>
  );
}
