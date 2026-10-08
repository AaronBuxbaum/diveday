import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import {
  controlClass,
  DateField,
  Field,
  FieldActions,
  FieldGrid,
  textareaClassFor,
} from "@/components/ui/form";
import type { WorkOrder } from "@/db/schema";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { WORK_ORDER_TEXT_LIMITS } from "@/lib/work-orders";
import { saveWorkOrderAction } from "../actions";

/**
 * **The job**: what came in, the day promised, who has it, the bench notes and
 * what the customer is told. One form and one Save, because these are written
 * together at the counter and again at the bench, and a page of small forms
 * each with its own Save loses whichever one was not pressed.
 *
 * A deleted ticket reads the same words back without the form.
 */
export function WorkOrderJobCard({
  workOrder,
  unit,
  staff,
  technicianName,
  readOnly,
  locale,
  t,
}: {
  workOrder: WorkOrder;
  /** The shop's own unit: nobody "reports" a problem with it, staff found one. */
  unit: boolean;
  staff: { person: { id: string; fullName: string } }[];
  technicianName: string | null;
  readOnly: boolean;
  locale: string;
  t: StaffTranslator;
}) {
  if (readOnly) {
    return (
      <SectionCard title={t("workOrders.detail.jobHeading")} padding="lg">
        <p className="whitespace-pre-line">{workOrder.reportedProblem}</p>
        <p className="mt-2 text-muted text-sm">
          {[
            workOrder.promisedOn
              ? t("workOrders.board.promised", {
                  date: formatCalendarDate(workOrder.promisedOn, locale),
                })
              : null,
            technicianName ? t("workOrders.board.with", { name: technicianName }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {workOrder.technicianNotes ? (
          <p className="mt-3 whitespace-pre-line text-muted">{workOrder.technicianNotes}</p>
        ) : null}
        {workOrder.workPerformed ? (
          <p className="mt-3 whitespace-pre-line">{workOrder.workPerformed}</p>
        ) : null}
      </SectionCard>
    );
  }

  // A technician no longer on the staff list stays selectable on the ticket
  // they already hold, so saving the notes never silently unassigns them.
  const assignedMissing =
    workOrder.technicianPersonId !== null &&
    !staff.some((member) => member.person.id === workOrder.technicianPersonId);

  return (
    <SectionCard title={t("workOrders.detail.jobHeading")} padding="lg">
      <FieldGrid as="form" action={saveWorkOrderAction} columns={2}>
        <input type="hidden" name="workOrderId" value={workOrder.id} />
        <Field
          label={t(
            unit ? "workOrders.form.reportedProblemUnit" : "workOrders.form.reportedProblem",
          )}
          htmlFor="reported-problem"
          required
          className="col-span-full"
        >
          <textarea
            id="reported-problem"
            name="reportedProblem"
            rows={3}
            required
            defaultValue={workOrder.reportedProblem}
            maxLength={WORK_ORDER_TEXT_LIMITS.reportedProblem}
            className={textareaClassFor(3)}
          />
        </Field>
        <Field
          label={t("workOrders.form.promisedOn")}
          hint={t("workOrders.form.optionalHint")}
          htmlFor="promised-on"
        >
          <DateField id="promised-on" name="promisedOn" defaultValue={workOrder.promisedOn ?? ""} />
        </Field>
        <Field label={t("workOrders.form.technician")} htmlFor="work-order-technician">
          <select
            id="work-order-technician"
            name="technicianPersonId"
            defaultValue={workOrder.technicianPersonId ?? ""}
            className={controlClass}
          >
            <option value="">{t("workOrders.form.technicianNone")}</option>
            {assignedMissing && workOrder.technicianPersonId && technicianName ? (
              <option value={workOrder.technicianPersonId}>{technicianName}</option>
            ) : null}
            {staff.map((member) => (
              <option key={member.person.id} value={member.person.id}>
                {member.person.fullName}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={t("workOrders.detail.technicianNotes")}
          hint={t("workOrders.detail.technicianNotesHint")}
          htmlFor="technician-notes"
          className="col-span-full"
        >
          <textarea
            id="technician-notes"
            name="technicianNotes"
            rows={3}
            defaultValue={workOrder.technicianNotes ?? ""}
            maxLength={WORK_ORDER_TEXT_LIMITS.technicianNotes}
            className={textareaClassFor(3)}
          />
        </Field>
        <Field
          label={t("workOrders.detail.workPerformed")}
          hint={t("workOrders.detail.workPerformedHint")}
          htmlFor="work-performed"
          className="col-span-full"
        >
          <textarea
            id="work-performed"
            name="workPerformed"
            rows={3}
            defaultValue={workOrder.workPerformed ?? ""}
            maxLength={WORK_ORDER_TEXT_LIMITS.workPerformed}
            className={textareaClassFor(3)}
          />
        </Field>
        <FieldActions>
          <SubmitButton
            pendingLabel={t("workOrders.form.saving")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("workOrders.form.save")}
          </SubmitButton>
        </FieldActions>
      </FieldGrid>
    </SectionCard>
  );
}
