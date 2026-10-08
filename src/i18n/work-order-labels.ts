import type { WorkOrderLineKindValue } from "@/db/schema";
import type { WorkOrderStatus } from "@/lib/work-orders";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * The work-order vocabulary (ADR 20261008-gear-work-orders): DiveDay's words
 * for where a ticket is and what a line on it is, never a shop's.
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

export function workOrderStatusLabel(t: StaffTranslator, status: WorkOrderStatus): string {
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

const LINE_KIND_KEYS: Record<WorkOrderLineKindValue, StaffMessageKey> = {
  part: "workOrders.lineKinds.part",
  labor: "workOrders.lineKinds.labor",
};

export function workOrderLineKindLabel(t: StaffTranslator, kind: WorkOrderLineKindValue): string {
  return t(LINE_KIND_KEYS[kind]);
}
