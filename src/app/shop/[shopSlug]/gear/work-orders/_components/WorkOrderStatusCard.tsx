import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import type { WorkOrder } from "@/db/schema";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { workOrderStatusLabel } from "@/i18n/work-order-labels";
import {
  type WorkOrderOutcome,
  type WorkOrderStatus,
  type WorkOrderSubject,
  workOrderMoves,
} from "@/lib/work-orders";
import { restoreWorkOrderAction, setWorkOrderStatusAction } from "../actions";

/**
 * **Where the ticket goes next**: one button per move this status allows
 * (`workOrderMoves`). The step the bench takes next is the primary button; the
 * others, backwards included, are secondary, so going back is offered without
 * ever being the loudest act on the card.
 *
 * "Picked up" is the one-way door: a collected ticket has nothing to move to,
 * so the card goes away and the header's badge says where it ended. Where that
 * door is a secondary button rather than the next step, it asks first.
 *
 * A deleted ticket shows Restore in the same place, because the act the
 * staffer wants is the one that undoes the mistake they just made.
 */
export function WorkOrderStatusCard({
  workOrder,
  subject,
  readOnly,
  t,
}: {
  workOrder: WorkOrder;
  subject: WorkOrderSubject;
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

  const { forward, others } = workOrderMoves(workOrder.status, subject);
  if (!forward && others.length === 0) return null;
  const outcome = workOrder.outcome as WorkOrderOutcome | null;
  const label = (status: WorkOrderStatus) => workOrderStatusLabel(t, status, subject, outcome);

  return (
    <SectionCard title={t("workOrders.detail.statusHeading")} padding="lg">
      <div className="flex flex-wrap gap-3">
        {forward ? (
          <MoveButton workOrderId={workOrder.id} status={forward} primary t={t}>
            {label(forward)}
          </MoveButton>
        ) : null}
        {others.map((status) => (
          <MoveButton
            key={status}
            workOrderId={workOrder.id}
            status={status}
            primary={false}
            confirmMessage={
              status === "picked_up" ? t("workOrders.detail.pickedUpConfirm") : undefined
            }
            t={t}
          >
            {label(status)}
          </MoveButton>
        ))}
      </div>
    </SectionCard>
  );
}

function MoveButton({
  workOrderId,
  status,
  primary,
  confirmMessage,
  t,
  children,
}: {
  workOrderId: string;
  status: WorkOrderStatus;
  primary: boolean;
  confirmMessage?: string;
  t: StaffTranslator;
  children: string;
}) {
  return (
    <form action={setWorkOrderStatusAction}>
      <input type="hidden" name="workOrderId" value={workOrderId} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton
        pendingLabel={t("workOrders.form.saving")}
        confirmMessage={confirmMessage}
        className={buttonClass(primary ? {} : { variant: "secondary" })}
      >
        {children}
      </SubmitButton>
    </form>
  );
}
