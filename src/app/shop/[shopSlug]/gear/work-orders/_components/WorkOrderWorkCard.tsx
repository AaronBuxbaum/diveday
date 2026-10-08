import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import {
  ChoiceFieldset,
  ChoiceRow,
  controlClass,
  DateField,
  Field,
  FieldActions,
  FieldGrid,
  textareaClassFor,
} from "@/components/ui/form";
import type { WorkOrderDetail } from "@/db/work-orders";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  workOrderCareLabel,
  workOrderOutcomeLabel,
  workOrderOutcomeTone,
} from "@/i18n/work-order-labels";
import { type CalendarDate, formatCalendarDate } from "@/lib/calendar-date";
import type { GearItemKind, GearServiceClock } from "@/lib/gear";
import {
  suggestCareDueOn,
  WORK_ORDER_OUTCOMES,
  WORK_ORDER_TEXT_LIMITS,
  type WorkOrderOutcome,
  workOrderCareKinds,
} from "@/lib/work-orders";
import { recordWorkOrderWorkAction } from "../actions";

/** One piece the job was done on: a customer's, or the shop's own unit (no piece id). */
type WorkPiece = { id: string | null; kind: GearItemKind; label: string };

/**
 * **The Work done record**: how the job ended and, when it was done, each
 * check the technician performed, passed or failed, on the day they did it,
 * with the next due date they confirm.
 *
 * It is the only thing on a ticket that moves a clock, so every value it
 * writes is on this form in front of the technician: the next due date is
 * prefilled (a shop unit carries its own interval forward; a cylinder and
 * anything without a convention get nothing) and they confirm or clear it.
 * Moving the ticket, pickup included, writes nothing.
 *
 * Recorded once; afterwards the card reads the record back.
 */
export function WorkOrderWorkCard({
  detail,
  previousClocks,
  todayLocal,
  locale,
  t,
}: {
  detail: WorkOrderDetail;
  /** A shop unit's last reading of each clock, carried into the suggestions. */
  previousClocks: readonly GearServiceClock[];
  todayLocal: CalendarDate;
  locale: string;
  t: StaffTranslator;
}) {
  const { workOrder } = detail;
  const pieces: WorkPiece[] =
    detail.subject === "unit" && detail.gearItemKind
      ? [{ id: null, kind: detail.gearItemKind, label: detail.gearItemLabel ?? "" }]
      : detail.pieces.map((piece) => ({
          id: piece.id,
          kind: piece.kind,
          label: [gearItemKindLabel(t, piece.kind), piece.brandModel].filter(Boolean).join(" · "),
        }));
  const outcome = workOrder.outcome as WorkOrderOutcome | null;

  if (outcome) {
    const pieceLabel = new Map(pieces.map((piece) => [piece.id ?? "unit", piece.label]));
    return (
      <SectionCard title={t("workOrders.work.heading")} padding="lg">
        <Badge tone={workOrderOutcomeTone(outcome)}>{workOrderOutcomeLabel(t, outcome)}</Badge>
        {workOrder.outcomeNote ? (
          <p className="mt-3 whitespace-pre-line">{workOrder.outcomeNote}</p>
        ) : null}
        {detail.care.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {detail.care.map((row) => (
              <li key={row.id}>
                <span className="font-medium">
                  {pieces.length > 1
                    ? `${pieceLabel.get(row.customerGearItemId ?? "unit") ?? ""} · `
                    : null}
                  {workOrderCareLabel(t, row.kind)}
                </span>{" "}
                <span className="text-muted">
                  {[
                    t(row.passed ? "workOrders.work.passed" : "workOrders.work.failed"),
                    formatCalendarDate(row.performedOn, locale),
                    row.nextDueOn
                      ? t("workOrders.work.nextDue", {
                          date: formatCalendarDate(row.nextDueOn, locale),
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </SectionCard>
    );
  }

  // Nothing to record on a deleted ticket, or one already collected: the
  // ticket's own record says what happened.
  if (workOrder.deletedAt !== null || workOrder.status === "picked_up") return null;

  const previous = new Map(previousClocks.map((clock) => [clock.kind, clock]));
  let index = 0;

  return (
    <SectionCard
      title={t("workOrders.work.heading")}
      description={t("workOrders.work.description")}
      padding="lg"
    >
      <FieldGrid as="form" action={recordWorkOrderWorkAction} columns={2}>
        <input type="hidden" name="workOrderId" value={workOrder.id} />
        <ChoiceFieldset
          legend={t("workOrders.work.outcome")}
          required
          className="col-span-full"
          bodyClassName="grid gap-1 sm:grid-cols-2"
        >
          {WORK_ORDER_OUTCOMES.map((value) => (
            <ChoiceRow
              key={value}
              type="radio"
              name="outcome"
              value={value}
              required
              defaultChecked={value === "done"}
            >
              {workOrderOutcomeLabel(t, value)}
            </ChoiceRow>
          ))}
        </ChoiceFieldset>
        <Field
          label={t("workOrders.work.outcomeNote")}
          hint={t("workOrders.work.outcomeNoteHint")}
          htmlFor="outcome-note"
          className="col-span-full"
        >
          <textarea
            id="outcome-note"
            name="outcomeNote"
            rows={2}
            maxLength={WORK_ORDER_TEXT_LIMITS.outcomeNote}
            className={textareaClassFor(2)}
          />
        </Field>
        <Field label={t("workOrders.work.performedOn")} htmlFor="performed-on" required>
          <DateField
            id="performed-on"
            name="performedOn"
            required
            max={todayLocal}
            defaultValue={todayLocal}
          />
        </Field>

        {pieces.map((piece) => (
          <fieldset key={piece.id ?? "unit"} className="col-span-full">
            <legend className="font-medium">{piece.label}</legend>
            <div className="mt-2 flex flex-col gap-4">
              {workOrderCareKinds(piece.kind).map((careKind) => {
                const n = index++;
                const clock = previous.get(careKind) ?? null;
                const suggested = suggestCareDueOn({
                  subject: detail.subject,
                  itemKind: piece.kind,
                  careKind,
                  performedOn: todayLocal,
                  previous: clock,
                });
                const careLabel = workOrderCareLabel(t, careKind);
                const runsClock = careKind !== "note";
                return (
                  <FieldGrid key={careKind} columns={3}>
                    <input type="hidden" name={`care.${n}.kind`} value={careKind} />
                    <input
                      type="hidden"
                      name={`care.${n}.customerGearItemId`}
                      value={piece.id ?? ""}
                    />
                    <Field label={careLabel} htmlFor={`care-${n}-result`}>
                      <select
                        id={`care-${n}-result`}
                        name={`care.${n}.result`}
                        className={controlClass}
                      >
                        <option value="">{t("workOrders.work.notDone")}</option>
                        <option value="passed">{t("workOrders.work.passed")}</option>
                        <option value="failed">{t("workOrders.work.failed")}</option>
                      </select>
                    </Field>
                    {runsClock ? (
                      <Field
                        label={t("workOrders.work.nextDueOn")}
                        hint={t("workOrders.form.optionalHint")}
                        htmlFor={`care-${n}-due`}
                      >
                        <DateField
                          id={`care-${n}-due`}
                          name={`care.${n}.nextDueOn`}
                          defaultValue={suggested ?? ""}
                        />
                      </Field>
                    ) : null}
                    {runsClock && detail.subject === "unit" ? (
                      <Field
                        label={t("workOrders.work.nextDueDives")}
                        hint={t("workOrders.form.optionalHint")}
                        htmlFor={`care-${n}-dives`}
                      >
                        <input
                          id={`care-${n}-dives`}
                          type="number"
                          name={`care.${n}.nextDueDives`}
                          min={1}
                          max={9999}
                          inputMode="numeric"
                          defaultValue={clock?.nextDueDives ?? ""}
                          className={controlClass}
                        />
                      </Field>
                    ) : null}
                  </FieldGrid>
                );
              })}
            </div>
          </fieldset>
        ))}

        <FieldActions>
          <SubmitButton
            pendingLabel={t("workOrders.work.recording")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("workOrders.work.record")}
          </SubmitButton>
        </FieldActions>
      </FieldGrid>
    </SectionCard>
  );
}
