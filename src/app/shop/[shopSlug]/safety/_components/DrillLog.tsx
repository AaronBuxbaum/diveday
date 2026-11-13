import { DiveDayIcon } from "@/components/DiveDayIcon";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
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

/** One mark per kind of drill; the tile's words come from the bundle. */
const DRILL_ICONS = {
  oxygen: "drill-oxygen",
  missing_diver: "drill-missing-diver",
  overboard: "drill-overboard",
  fire: "drill-fire",
} as const;

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
      {paper ? (
        <ul className="space-y-1 text-base">
          {view.since.map((line) => (
            <li key={line.kind} className={line.never ? "text-muted" : undefined}>
              {line.text}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {view.tiles.map((tile) => (
            <li
              key={tile.kind}
              className="flex flex-col items-center rounded-panel border border-border bg-surface px-3 py-5 text-center"
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-primary-tint text-primary">
                <DiveDayIcon name={DRILL_ICONS[tile.kind]} className="size-6" />
              </span>
              <p className="mt-3 text-sm font-semibold">{tile.label}</p>
              <p
                className={`mt-2 tabular-nums text-5xl font-semibold tracking-tight ${tile.days === null ? "text-muted" : ""}`}
              >
                {tile.days ?? "–"}
              </p>
              <p className="mt-1 text-sm text-muted">{tile.caption}</p>
            </li>
          ))}
        </ul>
      )}
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
          // Held drills start closed: the tiles say how long it has been, and
          // the list is there for the one who wants the names and notes.
          <DisclosureRowList className="mt-4">
            <DisclosureRow id="drills-held" heading={view.heldTitle} value={view.heldSummary}>
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
            </DisclosureRow>
          </DisclosureRowList>
        )
      ) : null}
      {paper ? null : (
        <DisclosureRowList className="mt-4">
          <DisclosureRow id="drill-new" heading={form.copy.logTitle}>
            <FieldGrid as="form" action={recordSafetyDrillAction} columns={2}>
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
