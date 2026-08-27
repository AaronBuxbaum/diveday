import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard, sectionCardClass } from "@/components/ui/card";
import { controlClass, Field, FieldActions } from "@/components/ui/form";
import type { GearServiceEventRow } from "@/db/gear";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { CalendarDate } from "@/lib/calendar-date";
import { formatCalendarDate } from "@/lib/calendar-date";
import { recordGearServiceAction } from "../actions";

/**
 * Freeform, dated observations about the unit itself — the tag runs loose,
 * the strap needs replacing next visit, a diver mentioned the mouthpiece
 * tastes off. This is `gear_service_events` rows of `kind: "note"`, the
 * schema's own "dated condition observation with no clock of its own"
 * (src/db/schema.ts) — no new table. It used to be reachable only by opening
 * the Service form and picking "Condition note" from the same dropdown that
 * offers Service/Hydro test/O2 clean, which buried it behind a form built for
 * a different question. This section is that one path, promoted: append-only,
 * like the rest of the unit's history, so there is no delete here either.
 */
export function GearItemNotes({
  gearItemId,
  notes,
  todayLocal,
  locale,
  t,
  readOnly,
}: {
  gearItemId: string;
  notes: GearServiceEventRow[];
  todayLocal: CalendarDate;
  locale: string;
  t: StaffTranslator;
  readOnly: boolean;
}) {
  return (
    <SectionCard padding="lg" title={t("gear.unit.notes.title")}>
      {notes.length > 0 ? (
        <ul className="grid gap-3">
          {notes.map((note) => (
            <li
              key={note.id}
              className={sectionCardClass({
                padding: "md",
                className: "bg-surface-sunken shadow-none",
              })}
            >
              <p className="whitespace-pre-wrap text-sm">{note.note}</p>
              <p className="mt-1 text-xs text-muted">
                {note.recordedByName
                  ? t("gear.unit.notes.writtenBy", {
                      name: note.recordedByName,
                      date: formatCalendarDate(note.servicedOn, locale),
                    })
                  : formatCalendarDate(note.servicedOn, locale)}
              </p>
            </li>
          ))}
        </ul>
      ) : readOnly ? null : (
        <p className="text-sm text-muted">{t("gear.unit.notes.empty")}</p>
      )}

      {readOnly ? null : (
        <form
          action={recordGearServiceAction}
          className={`grid gap-3 ${notes.length > 0 ? "mt-5 border-t border-border pt-5" : "mt-4"}`}
        >
          <input type="hidden" name="gearItemId" value={gearItemId} />
          <input type="hidden" name="kind" value="note" />
          <input type="hidden" name="servicedOn" value={todayLocal} />
          <Field label={t("gear.unit.notes.addLabel")}>
            <textarea
              name="note"
              required
              maxLength={500}
              rows={3}
              placeholder={t("gear.unit.notes.placeholder")}
              className={controlClass}
            />
          </Field>
          <FieldActions>
            <SubmitButton
              pendingLabel={t("gear.unit.notes.adding")}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("gear.unit.notes.add")}
            </SubmitButton>
          </FieldActions>
        </form>
      )}
    </SectionCard>
  );
}
