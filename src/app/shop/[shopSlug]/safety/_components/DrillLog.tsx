import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { DisclosureRow, DisclosureRowList } from "@/components/ui/disclosure";
import {
  ChoiceFieldset,
  ChoiceRow,
  controlClass,
  DateField,
  Field,
  FieldGrid,
  textareaClassFor,
} from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { deleteSafetyDrillAction, recordSafetyDrillAction } from "../actions";
import type { DrillLogView } from "./drill-log-read";

/**
 * **The drill log** (loop 5, row 2): one line per kind of drill saying how
 * long ago the shop last held it, the drills held in the month being read,
 * and the form to log one. On the printed sheet (`paper`) it is the lines and
 * the month's drills, with no form and no control.
 */
export function DrillLog({ view, paper = false }: { view: DrillLogView; paper?: boolean }) {
  const { form } = view;
  const hasHeld = view.held.length !== 0;
  return (
    <section id="drills" aria-labelledby="drills-title" className="scroll-mt-24 break-inside-avoid">
      <h2
        id="drills-title"
        className={paper ? "mb-1 text-sm font-bold" : `mb-3 ${SECTION_TITLE_CLASS}`}
      >
        {view.title}
      </h2>
      <ul className="space-y-1 text-base">
        {view.since.map((line) => (
          <li key={line.kind} className={line.never ? "text-muted" : undefined}>
            {line.text}
          </li>
        ))}
      </ul>
      {hasHeld ? (
        paper ? (
          <div className="mt-3">
            <h3 className="mb-1 text-sm font-bold">{view.heldTitle}</h3>
            <ul className="divide-y divide-border">
              {view.held.map((drill) => (
                <li key={drill.id} className="py-2">
                  <p className="font-medium">{drill.line}</p>
                  {drill.people ? <p className="text-sm">{drill.people}</p> : null}
                  {drill.note ? <p className="text-sm text-muted">{drill.note}</p> : null}
                  <p className="text-xs text-muted">{drill.logged}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <SectionCard title={view.heldTitle} titleAs="h3" className="mt-4">
            <ul className="divide-y divide-border">
              {view.held.map((drill) => (
                <li
                  key={drill.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{drill.line}</p>
                    {drill.people ? <p className="text-sm">{drill.people}</p> : null}
                    {drill.note ? <p className="text-sm text-muted">{drill.note}</p> : null}
                    <p className="text-xs text-muted">{drill.logged}</p>
                  </div>
                  <form action={deleteSafetyDrillAction}>
                    <input type="hidden" name="drillId" value={drill.id} />
                    {form.month ? <input type="hidden" name="month" value={form.month} /> : null}
                    <InlineConfirm
                      formAction={deleteSafetyDrillAction}
                      triggerLabel={form.copy.delete}
                      confirmLabel={form.copy.deleteConfirm}
                      pendingLabel={form.copy.deleting}
                      triggerClassName={buttonClass({
                        variant: "danger-ghost",
                        flush: true,
                        className: "focus-visible:focus-ring-inset",
                      })}
                    />
                  </form>
                </li>
              ))}
            </ul>
          </SectionCard>
        )
      ) : null}
      {paper ? null : (
        <DisclosureRowList className="mt-4 print:hidden">
          <DisclosureRow id="drill-new" heading={form.copy.logTitle}>
            <FieldGrid as="form" action={recordSafetyDrillAction} columns={2}>
              {form.month ? <input type="hidden" name="month" value={form.month} /> : null}
              <Field label={form.copy.kindLabel}>
                <select name="kind" required className={controlClass} defaultValue="oxygen">
                  {form.kinds.map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={form.copy.dateLabel}>
                <DateField
                  name="heldOn"
                  required
                  min={form.earliest}
                  max={form.today}
                  defaultValue={form.today}
                />
              </Field>
              {form.staff.length > 0 ? (
                <ChoiceFieldset
                  legend={form.copy.peopleLabel}
                  className="sm:col-span-2"
                  bodyClassName="grid gap-x-4 sm:grid-cols-2"
                >
                  {form.staff.map((member) => (
                    <ChoiceRow key={member.id} type="checkbox" name="participant" value={member.id}>
                      {member.name}
                    </ChoiceRow>
                  ))}
                </ChoiceFieldset>
              ) : null}
              <Field
                label={form.copy.noteLabel}
                hint={form.copy.optional}
                className="sm:col-span-2"
              >
                <textarea
                  name="note"
                  rows={2}
                  maxLength={form.noteMax}
                  className={textareaClassFor(2)}
                />
              </Field>
              <div className="flex justify-end sm:col-span-2">
                <SubmitButton
                  pendingLabel={form.copy.saving}
                  className={buttonClass({ variant: "primary" })}
                >
                  {form.copy.submit}
                </SubmitButton>
              </div>
            </FieldGrid>
          </DisclosureRow>
        </DisclosureRowList>
      )}
    </section>
  );
}
