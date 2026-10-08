import type { WorkOrderLineKindValue } from "@/db/schema";
import type { GearServiceKind } from "@/lib/gear";
import type { WorkOrderOutcome, WorkOrderStatus, WorkOrderSubject } from "@/lib/work-orders";
import { gearServiceKindLabel } from "./gear-labels";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * The work-order vocabulary (ADR 20261008-gear-work-orders): DiveDay's words
 * for where a ticket is, how its job ended and what a line on it is, never a
 * shop's.
 *
 * Total by construction, like `gear-labels.ts`: a status added to the enum
 * without a wording decision is a compile error here rather than a raw
 * database code on a staff screen.
 */
const STATUS_KEYS: Record<WorkOrderStatus, StaffMessageKey> = {
  received: "workOrders.status.received",
  in_progress: "workOrders.status.inProgress",
  waiting_on_parts: "workOrders.status.waitingOnParts",
  ready: "workOrders.status.ready",
  picked_up: "workOrders.status.pickedUp",
};

/**
 * A status in the words its subject calls for. A customer's ticket ends with
 * the owner collecting it; a shop unit's ends with the unit leaving the bench,
 * and it reads "Back in service" only when the Work done record says the job
 * was done — a condemned cylinder must never wear those words. Without that
 * record it is just "Off the bench".
 */
export function workOrderStatusLabel(
  t: StaffTranslator,
  status: WorkOrderStatus,
  subject: WorkOrderSubject = "customer",
  outcome: WorkOrderOutcome | null = null,
): string {
  if (subject === "unit" && status === "picked_up") {
    return t(
      outcome === "done" ? "workOrders.status.backInService" : "workOrders.status.offTheBench",
    );
  }
  return t(STATUS_KEYS[status]);
}

/**
 * The tone each status carries. `ready` is the shop's good news and the only
 * primary here; everything else is the ordinary state of a bench, and a board
 * where four of five rows shout says nothing. Late is the board's own warning
 * and is not a status (`workOrderIsLate`).
 */
const STATUS_TONES: Record<WorkOrderStatus, "primary" | "neutral"> = {
  received: "neutral",
  in_progress: "neutral",
  waiting_on_parts: "neutral",
  ready: "primary",
  picked_up: "neutral",
};

export function workOrderStatusTone(status: WorkOrderStatus): "primary" | "neutral" {
  return STATUS_TONES[status];
}

const OUTCOME_KEYS: Record<WorkOrderOutcome, StaffMessageKey> = {
  done: "workOrders.outcomes.done",
  declined: "workOrders.outcomes.declined",
  unserviceable: "workOrders.outcomes.unserviceable",
  condemned: "workOrders.outcomes.condemned",
};

export function workOrderOutcomeLabel(t: StaffTranslator, outcome: WorkOrderOutcome): string {
  return t(OUTCOME_KEYS[outcome]);
}

/**
 * An outcome's tone. Condemned is the one that must stop somebody diving it;
 * gear the shop could not fix is a caution; done and declined are ordinary.
 */
const OUTCOME_TONES: Record<WorkOrderOutcome, "success" | "neutral" | "warning" | "danger"> = {
  done: "success",
  declined: "neutral",
  unserviceable: "warning",
  condemned: "danger",
};

export function workOrderOutcomeTone(
  outcome: WorkOrderOutcome,
): "success" | "neutral" | "warning" | "danger" {
  return OUTCOME_TONES[outcome];
}

/**
 * A check on the Work done record: the register's own clock names, except
 * `note`, which on a ticket is other work that runs no clock.
 */
export function workOrderCareLabel(t: StaffTranslator, kind: GearServiceKind): string {
  return kind === "note" ? t("workOrders.care.other") : gearServiceKindLabel(t, kind);
}

const LINE_KIND_KEYS: Record<WorkOrderLineKindValue, StaffMessageKey> = {
  part: "workOrders.lineKinds.part",
  labor: "workOrders.lineKinds.labor",
};

export function workOrderLineKindLabel(t: StaffTranslator, kind: WorkOrderLineKindValue): string {
  return t(LINE_KIND_KEYS[kind]);
}
