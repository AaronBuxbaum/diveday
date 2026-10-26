import { GroupLabel } from "@/components/ui/group-label";
import { LedgerRow } from "@/components/ui/ledger";
import { fill } from "@/i18n/fill";
import type { StaffWeek } from "@/lib/staffing-week";
import { ShiftRemoveMenu } from "./ShiftRemoveMenu";
import type { StaffingWeekWords } from "./StaffingWeek";
import { ShiftFace } from "./staffing-shift-face";

type Person = StaffWeek["people"][number];

/** The day's shifts and away facts follow its departure crews as their own group. */
export function StaffingPersonalRows({
  rows,
  day,
  words,
  canManage,
  locale,
  timeZone,
  deleteShiftAction,
}: {
  rows: readonly { person: Person; cell: Person["days"][number] }[];
  day: { label: string; isPast: boolean };
  words: StaffingWeekWords;
  canManage: boolean;
  locale: string;
  timeZone: string;
  deleteShiftAction: (formData: FormData) => void;
}) {
  const personal = rows.filter(({ cell }) => cell.shifts.length > 0 || cell.away.length > 0);
  return (
    <>
      {personal.length > 0 ? (
        <li className="pt-5 pb-1">
          <GroupLabel as="h4">{words.shiftsAndAway}</GroupLabel>
        </li>
      ) : null}
      {personal.map(({ person, cell }) => (
        <LedgerRow key={person.personId} stacked>
          <p className="text-base font-semibold">{person.name}</p>
          {/* Each shift and away fact keeps its existing 44px touch target. */}
          <div className="mt-1 flex flex-col">
            {cell?.shifts.map((shift) => (
              <div
                key={shift.id}
                className="flex min-h-11 items-center justify-between gap-2 text-base"
              >
                <ShiftFace shift={shift} locale={locale} timeZone={timeZone} isPast={day.isPast} />
                {canManage ? (
                  <ShiftRemoveMenu
                    label={fill(words.shiftAria, {
                      person: person.name,
                      day: day.label,
                    })}
                    shiftId={shift.id}
                    words={words}
                    action={deleteShiftAction}
                  />
                ) : null}
              </div>
            ))}
            {cell?.away.map((block) => (
              <p key={block.id} className="flex min-h-11 items-center text-base text-muted">
                {words.away}
                {block.note ? ` · ${block.note}` : ""}
              </p>
            ))}
          </div>
        </LedgerRow>
      ))}
    </>
  );
}
