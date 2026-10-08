import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import type { WorkOrder } from "@/db/schema";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { workOrderStatusLabel } from "@/i18n/work-order-labels";
import { workOrderStatusMoves } from "@/lib/work-orders";
import {
  assignWorkOrderTechnicianAction,
  restoreWorkOrderAction,
  setWorkOrderStatusAction,
} from "../actions";

/**
 * **Where the ticket is, and who has it** — the two acts a technician reaches
 * for most, so they open the ticket.
 *
 * The status select offers only the moves this status allows
 * (`workOrderStatusMoves`), which is how "Picked up" stays the one-way door it
 * is in the domain: a collected ticket has nothing to move to, and a new one
 * is opened instead.
 *
 * A deleted ticket shows Restore in the same place, because the act the
 * staffer wants is the one that undoes the mistake they just made.
 */
export function WorkOrderStatusCard({
  workOrder,
  staff,
  readOnly,
  t,
}: {
  workOrder: WorkOrder;
  staff: { person: { id: string; fullName: string } }[];
  /** A deleted ticket: the record stays readable, the acts become Restore. */
  readOnly: boolean;
  t: StaffTranslator;
}) {
  if (readOnly) {
    return (
      <SectionCard title={t("workOrders.detail.statusHeading")} padding="lg">
        <form action={restoreWorkOrderAction}>
          <input type="hidden" name="workOrderId" value={workOrder.id} />
          <SubmitButton pendingLabel={t("workOrders.detail.restoring")} className={buttonClass()}>
            {t("workOrders.detail.restore")}
          </SubmitButton>
        </form>
      </SectionCard>
    );
  }

  // **A collected ticket has no acts.** `picked_up` is terminal in the domain,
  // so there is no status to move to and no technician to hand it to: gear
  // that comes back is a new ticket. The header's badge already says where it
  // is, so the card goes away rather than standing there with an empty select.
  const moves = workOrderStatusMoves(workOrder.status);
  if (moves.length === 0) return null;

  return (
    <SectionCard title={t("workOrders.detail.statusHeading")} padding="lg">
      <FieldGrid as="form" action={setWorkOrderStatusAction} columns={2}>
        <input type="hidden" name="workOrderId" value={workOrder.id} />
        <Field label={t("workOrders.form.moveTo")} htmlFor="work-order-status">
          <select id="work-order-status" name="status" className={controlClass}>
            {moves.map((status) => (
              <option key={status} value={status}>
                {workOrderStatusLabel(t, status)}
              </option>
            ))}
          </select>
        </Field>
        <FieldActions>
          <SubmitButton pendingLabel={t("workOrders.form.saving")} className={buttonClass()}>
            {t("workOrders.form.save")}
          </SubmitButton>
        </FieldActions>
      </FieldGrid>

      <FieldGrid as="form" action={assignWorkOrderTechnicianAction} columns={2} className="mt-8">
        <input type="hidden" name="workOrderId" value={workOrder.id} />
        <Field label={t("workOrders.form.technician")} htmlFor="work-order-technician">
          <select
            id="work-order-technician"
            name="technicianPersonId"
            defaultValue={workOrder.technicianPersonId ?? ""}
            className={controlClass}
          >
            <option value="">{t("workOrders.form.technicianNone")}</option>
            {staff.map((member) => (
              <option key={member.person.id} value={member.person.id}>
                {member.person.fullName}
              </option>
            ))}
          </select>
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
