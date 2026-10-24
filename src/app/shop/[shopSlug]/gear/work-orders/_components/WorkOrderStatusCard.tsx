import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { ChoiceFieldset } from "@/components/ui/form";
import type { WorkOrder } from "@/db/schema";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { workOrderStatusLabel, workOrderStatusTone } from "@/i18n/work-order-labels";
import {
  type WorkOrderOutcome,
  type WorkOrderStatus,
  type WorkOrderSubject,
  workOrderMoves,
} from "@/lib/work-orders";
import { restoreWorkOrderAction, setWorkOrderStatusAction } from "../actions";

/**
 * **Where the ticket goes next**: the status it is in, as a static pill, then
 * one secondary button per move this status allows (`workOrderMoves`), the
 * step the bench takes next first. No move is filled: the pill says where the
 * ticket is, and every button is a place it can go (visual review 2026-10-24,
 * A29).
 *
 * "Picked up" is the one-way door: a collected ticket has nothing to move to,
 * so the card goes away and the header's badge says where it ended. Where that
 * door is a secondary button rather than the next step, it asks first.
 *
 * A deleted ticket shows Restore in the same place, because the act the
 * staffer wants is the one that undoes the mistake they just made.
 *
 * **Actions, captioned as moves, never a segmented control** (UX review
 * 2026-10-10, item 25). Four status words in a row read as a picker whose
 * filled one was the current status, so "In progress" looked already chosen
 * on a ticket that was Received. The caption "Move to" says each button is a
 * move; the current status is a pill, never a button.
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
      <ChoiceFieldset
        legend={t("workOrders.detail.moveTo")}
        className="min-w-0"
        bodyClassName="flex flex-wrap gap-3"
      >
        <Badge tone={workOrderStatusTone(workOrder.status)} className="self-center">
          {label(workOrder.status)}
        </Badge>
        {forward ? (
          <MoveButton workOrderId={workOrder.id} status={forward} t={t}>
            {label(forward)}
          </MoveButton>
        ) : null}
        {others.map((status) => (
          <MoveButton
            key={status}
            workOrderId={workOrder.id}
            status={status}
            confirmMessage={
              status === "picked_up" ? t("workOrders.detail.pickedUpConfirm") : undefined
            }
            t={t}
          >
            {label(status)}
          </MoveButton>
        ))}
      </ChoiceFieldset>
    </SectionCard>
  );
}

function MoveButton({
  workOrderId,
  status,
  confirmMessage,
  t,
  children,
}: {
  workOrderId: string;
  status: WorkOrderStatus;
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
        className={buttonClass({ variant: "secondary" })}
      >
        {children}
      </SubmitButton>
    </form>
  );
}
