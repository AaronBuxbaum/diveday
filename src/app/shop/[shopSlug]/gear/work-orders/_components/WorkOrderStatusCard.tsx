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
 * **Where the ticket goes next**: show current status as a non-interactive
 * pill, the forward move as a secondary button, and other allowed moves in a
 * menu. The labelled ChoiceFieldset groups actions; status is never a choice
 * or picker selection.
 *
 * Pickup requires confirmation. Collected tickets have no further moves; the
 * header badge shows outcome. Deleted tickets offer Restore only.
 *
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
