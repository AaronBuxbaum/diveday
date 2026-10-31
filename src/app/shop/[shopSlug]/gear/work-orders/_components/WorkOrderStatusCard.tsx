import { MoreMenu } from "@/components/MoreMenu";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { ChoiceFieldset } from "@/components/ui/form";
import { menuRowClass } from "@/components/ui/menu";
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
 * **Where the ticket goes next**: the current status as a non-interactive pill,
 * then the next move (`workOrderMoves().forward`) as a secondary button, then
 * every other allowed move in the "other moves" menu. The status is never a
 * button and no move is pre-selected, so the "Move to" caption reads each
 * action as a move rather than a picker.
 *
 * "Picked up" is the one-way door. Once collected there are no moves left, so
 * the card is hidden and the header badge shows the outcome. In the menu,
 * "Picked up" asks for confirmation first.
 *
 * A deleted ticket (`readOnly`) shows only Restore in the same place.
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
      <SectionCard
        title={t("workOrders.detail.statusHeading")}
        padding="lg"
        className="print:hidden"
      >
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
    <SectionCard title={t("workOrders.detail.statusHeading")} padding="lg" className="print:hidden">
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
        {others.length > 0 ? (
          <MoreMenu label={t("workOrders.detail.otherMoves")} size="sm">
            {others.map((status) => (
              <MoveButton
                key={status}
                workOrderId={workOrder.id}
                status={status}
                quiet
                confirmMessage={
                  status === "picked_up" ? t("workOrders.detail.pickedUpConfirm") : undefined
                }
                t={t}
              >
                {label(status)}
              </MoveButton>
            ))}
          </MoreMenu>
        ) : null}
      </ChoiceFieldset>
    </SectionCard>
  );
}

function MoveButton({
  workOrderId,
  status,
  confirmMessage,
  quiet = false,
  t,
  children,
}: {
  workOrderId: string;
  status: WorkOrderStatus;
  confirmMessage?: string;
  quiet?: boolean;
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
        className={
          quiet ? menuRowClass("quiet", { gutter: false }) : buttonClass({ variant: "secondary" })
        }
      >
        {children}
      </SubmitButton>
    </form>
  );
}
