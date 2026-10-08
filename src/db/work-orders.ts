import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type CalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { GearItemKind } from "@/lib/gear";
import {
  canMoveWorkOrder,
  suggestCustomerServiceDueOn,
  WORK_ORDER_MAX_UNIT_AMOUNT_CENTS,
  type WorkOrderStatus,
  workOrderIsLate,
  workOrderLineTotalCents,
  workOrderServiceClock,
  workOrderStatusRank,
  workOrderTotalCents,
} from "@/lib/work-orders";
import type { AppDb } from "./client";
import { personSearchMatch } from "./person-search";
import {
  type CustomerGearItem,
  customerGearItems,
  gearItems,
  gearServiceEvents,
  people,
  personRoles,
  type WorkOrder,
  type WorkOrderEvent,
  type WorkOrderLine,
  type WorkOrderLineKindValue,
  workOrderEvents,
  workOrderItems,
  workOrderLines,
  workOrderStatus,
  workOrders,
} from "./schema";

/**
 * Reads and writes for service work orders (ADR 20261008-gear-work-orders).
 *
 * Three invariants live here rather than in a surface:
 *
 * - **A ticket has exactly one subject** — a customer or a fleet unit — which
 *   the `work_orders_one_subject` check holds at the database and every writer
 *   here refuses before it gets there.
 * - **A status move is a recorded act.** Every write that changes status or
 *   technician appends a `work_order_events` row in the same transaction, so
 *   "who had it, and for how long" is read out of history rather than guessed
 *   from one mutable column.
 * - **Finishing a ticket moves a service clock.** A fleet ticket writes the
 *   unit's own `gear_service_events` row; a customer ticket sets each piece's
 *   `service_due_on` where staff have not already set one. Both borrow the
 *   register's interval conventions (`src/lib/work-orders.ts`).
 */

// The lib union and the pg enum must never drift: a value added to one side
// without the other is a compile error here, not a migration at 2am.
workOrderStatus.enumValues satisfies readonly WorkOrderStatus[];

function optional(value: string | undefined | null) {
  return value?.trim() || null;
}

/** The live-rows filter every read that means "this shop's tickets" carries. */
const liveWorkOrder = () => isNull(workOrders.deletedAt);

/** The same, for a customer's own pieces. */
const liveCustomerItem = () => isNull(customerGearItems.deletedAt);

/** And for a line, which a staffer deletes when it was typed in error. */
const liveLine = () => isNull(workOrderLines.deletedAt);

// ---------------------------------------------------------------------------
// A customer's own gear
// ---------------------------------------------------------------------------

export type CustomerGearItemInput = {
  shopId: string;
  personId: string;
  kind: GearItemKind;
  brandModel?: string;
  serialNumber?: string;
  note?: string;
  serviceDueOn?: string;
};

export type SaveCustomerGearItemOutcome =
  | { ok: true; item: CustomerGearItem }
  | { ok: false; reason: "not_found" | "invalid_date" };

/** Record one piece of a diver's own kit on their record. */
export async function addCustomerGearItem(
  db: AppDb,
  input: CustomerGearItemInput,
): Promise<SaveCustomerGearItemOutcome> {
  const serviceDueOn = optional(input.serviceDueOn);
  if (serviceDueOn && !isValidCalendarDate(serviceDueOn)) {
    return { ok: false, reason: "invalid_date" };
  }
  const [item] = await db
    .insert(customerGearItems)
    .values({
      shopId: input.shopId,
      personId: input.personId,
      kind: input.kind,
      brandModel: optional(input.brandModel),
      serialNumber: optional(input.serialNumber),
      note: optional(input.note),
      serviceDueOn,
    })
    .returning();
  return item ? { ok: true, item } : { ok: false, reason: "not_found" };
}

/** Edit a piece — including the next-service date a finished ticket suggested. */
export async function updateCustomerGearItem(
  db: AppDb,
  input: Omit<CustomerGearItemInput, "personId"> & { customerGearItemId: string },
): Promise<SaveCustomerGearItemOutcome> {
  const serviceDueOn = optional(input.serviceDueOn);
  if (serviceDueOn && !isValidCalendarDate(serviceDueOn)) {
    return { ok: false, reason: "invalid_date" };
  }
  const [item] = await db
    .update(customerGearItems)
    .set({
      kind: input.kind,
      brandModel: optional(input.brandModel),
      serialNumber: optional(input.serialNumber),
      note: optional(input.note),
      serviceDueOn,
      updatedAt: nowDate(),
    })
    .where(
      and(
        eq(customerGearItems.id, input.customerGearItemId),
        eq(customerGearItems.shopId, input.shopId),
        liveCustomerItem(),
      ),
    )
    .returning();
  return item ? { ok: true, item } : { ok: false, reason: "not_found" };
}

export type DeleteCustomerGearItemOutcome =
  | { ok: true; deleted: CustomerGearItem }
  | { ok: false; reason: "not_found" | "on_open_work_order" };

/**
 * Take a piece off a diver's record — soft, like every other delete (ADR
 * 20260820-every-delete-is-soft).
 *
 * **Refuses a piece that is on an open ticket**, the call `deleteGearItem`
 * makes for a reserved unit and for the same reason: the shop physically has
 * it, and hiding the row would leave a technician holding a regulator the
 * record no longer admits to.
 */
export async function deleteCustomerGearItem(
  db: AppDb,
  input: { shopId: string; customerGearItemId: string; deletedByPersonId?: string },
): Promise<DeleteCustomerGearItemOutcome> {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(customerGearItems)
      .where(
        and(
          eq(customerGearItems.id, input.customerGearItemId),
          eq(customerGearItems.shopId, input.shopId),
          liveCustomerItem(),
        ),
      )
      .limit(1)
      .for("update");
    if (!item) return { ok: false, reason: "not_found" } as const;

    const [held] = await tx
      .select({ value: count() })
      .from(workOrderItems)
      .innerJoin(workOrders, eq(workOrders.id, workOrderItems.workOrderId))
      .where(
        and(
          eq(workOrderItems.customerGearItemId, item.id),
          eq(workOrders.shopId, input.shopId),
          liveWorkOrder(),
          sql`${workOrders.status} <> 'picked_up'`,
        ),
      );
    if ((held?.value ?? 0) > 0) return { ok: false, reason: "on_open_work_order" } as const;

    const [deleted] = await tx
      .update(customerGearItems)
      .set({
        deletedAt: nowDate(),
        deletedByPersonId: input.deletedByPersonId ?? null,
        updatedAt: nowDate(),
      })
      .where(eq(customerGearItems.id, item.id))
      .returning();
    return deleted
      ? ({ ok: true, deleted } as const)
      : ({ ok: false, reason: "not_found" } as const);
  });
}

/** Put a deleted piece back, which is what the undo beside the delete calls. */
export async function restoreCustomerGearItem(
  db: AppDb,
  input: { shopId: string; customerGearItemId: string },
): Promise<SaveCustomerGearItemOutcome> {
  const [item] = await db
    .update(customerGearItems)
    .set({ deletedAt: null, deletedByPersonId: null, updatedAt: nowDate() })
    .where(
      and(
        eq(customerGearItems.id, input.customerGearItemId),
        eq(customerGearItems.shopId, input.shopId),
      ),
    )
    .returning();
  return item ? { ok: true, item } : { ok: false, reason: "not_found" };
}

/** One diver's own pieces, oldest first — the order they were recorded in. */
export async function listCustomerGearItems(
  db: AppDb,
  shopId: string,
  personId: string,
): Promise<CustomerGearItem[]> {
  return db
    .select()
    .from(customerGearItems)
    .where(
      and(
        eq(customerGearItems.shopId, shopId),
        eq(customerGearItems.personId, personId),
        liveCustomerItem(),
      ),
    )
    .orderBy(
      asc(customerGearItems.createdAt),
      asc(customerGearItems.kind),
      asc(customerGearItems.brandModel),
      asc(customerGearItems.id),
    );
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export type CreateWorkOrderInput = {
  shopId: string;
  /** A customer's ticket: the diver, and the pieces of theirs it covers. */
  personId?: string;
  customerGearItemIds?: readonly string[];
  /** Or a bench ticket on one of the shop's own units. */
  gearItemId?: string;
  reportedProblem: string;
  promisedOn?: string;
  technicianPersonId?: string;
  actorPersonId?: string;
};

export type CreateWorkOrderOutcome =
  | { ok: true; workOrder: WorkOrder }
  | {
      ok: false;
      reason:
        | "no_subject"
        | "two_subjects"
        | "empty_problem"
        | "invalid_date"
        | "not_found"
        | "no_items";
    };

/**
 * Open a ticket. One subject, at least one piece when that subject is a
 * customer, and a `created` history row — all in one transaction, so a ticket
 * never exists without the drop-off it records.
 */
export async function createWorkOrder(
  db: AppDb,
  input: CreateWorkOrderInput,
): Promise<CreateWorkOrderOutcome> {
  const reportedProblem = input.reportedProblem.trim();
  if (!reportedProblem) return { ok: false, reason: "empty_problem" };
  const promisedOn = optional(input.promisedOn);
  if (promisedOn && !isValidCalendarDate(promisedOn)) return { ok: false, reason: "invalid_date" };
  if (input.personId && input.gearItemId) return { ok: false, reason: "two_subjects" };
  if (!input.personId && !input.gearItemId) return { ok: false, reason: "no_subject" };
  const itemIds = [...new Set(input.customerGearItemIds ?? [])];
  if (input.personId && itemIds.length === 0) return { ok: false, reason: "no_items" };

  return db.transaction(async (tx) => {
    if (input.gearItemId) {
      const [unit] = await tx
        .select({ id: gearItems.id })
        .from(gearItems)
        .where(
          and(
            eq(gearItems.id, input.gearItemId),
            eq(gearItems.shopId, input.shopId),
            isNull(gearItems.deletedAt),
          ),
        )
        .limit(1);
      if (!unit) return { ok: false, reason: "not_found" } as const;
    }

    if (input.personId) {
      const owned = await tx
        .select({ id: customerGearItems.id })
        .from(customerGearItems)
        .where(
          and(
            inArray(customerGearItems.id, itemIds),
            eq(customerGearItems.shopId, input.shopId),
            eq(customerGearItems.personId, input.personId),
            liveCustomerItem(),
          ),
        );
      // Every piece must be this diver's own, live, and at this shop — a stale
      // tab must not be able to put somebody else's regulator on this ticket.
      if (owned.length !== itemIds.length) return { ok: false, reason: "not_found" } as const;
    }

    const [workOrder] = await tx
      .insert(workOrders)
      .values({
        shopId: input.shopId,
        personId: input.personId ?? null,
        gearItemId: input.gearItemId ?? null,
        status: "received",
        reportedProblem,
        promisedOn,
        technicianPersonId: input.technicianPersonId ?? null,
        receivedAt: nowDate(),
      })
      .returning();
    if (!workOrder) return { ok: false, reason: "not_found" } as const;

    if (itemIds.length > 0) {
      await tx.insert(workOrderItems).values(
        itemIds.map((customerGearItemId) => ({
          shopId: input.shopId,
          workOrderId: workOrder.id,
          customerGearItemId,
        })),
      );
    }

    await tx.insert(workOrderEvents).values({
      shopId: input.shopId,
      workOrderId: workOrder.id,
      kind: "created",
      toStatus: "received",
      technicianPersonId: input.technicianPersonId ?? null,
      actorPersonId: input.actorPersonId ?? null,
      createdAt: nowDate(),
    });

    return { ok: true, workOrder } as const;
  });
}

export type SetWorkOrderStatusOutcome =
  | { ok: true; workOrder: WorkOrder }
  | { ok: false; reason: "not_found" | "already" | "closed" };

/**
 * Move a ticket, stamp what the move means, and move the service clock when
 * the move finishes the job.
 *
 * `ready_at` is kept when a ticket goes back on the bench: the first time the
 * shop said "ready" is a fact about how the job ran, and overwriting it would
 * quietly rewrite the history the events table exists to keep.
 */
export async function setWorkOrderStatus(
  db: AppDb,
  input: {
    shopId: string;
    workOrderId: string;
    status: WorkOrderStatus;
    todayLocal: CalendarDate;
    actorPersonId?: string;
  },
): Promise<SetWorkOrderStatusOutcome> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(workOrders)
      .where(
        and(
          eq(workOrders.id, input.workOrderId),
          eq(workOrders.shopId, input.shopId),
          liveWorkOrder(),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) return { ok: false, reason: "not_found" } as const;
    if (current.status === input.status) return { ok: false, reason: "already" } as const;
    if (!canMoveWorkOrder(current.status, input.status)) {
      return { ok: false, reason: "closed" } as const;
    }

    const now = nowDate();
    const [updated] = await tx
      .update(workOrders)
      .set({
        status: input.status,
        readyAt: input.status === "ready" ? (current.readyAt ?? now) : current.readyAt,
        pickedUpAt: input.status === "picked_up" ? now : current.pickedUpAt,
        updatedAt: now,
      })
      .where(eq(workOrders.id, current.id))
      .returning();
    if (!updated) return { ok: false, reason: "not_found" } as const;

    await tx.insert(workOrderEvents).values({
      shopId: input.shopId,
      workOrderId: current.id,
      kind: "status_changed",
      fromStatus: current.status,
      toStatus: input.status,
      actorPersonId: input.actorPersonId ?? null,
      createdAt: now,
    });

    if (input.status === "picked_up") {
      await moveServiceClocks(tx, {
        shopId: input.shopId,
        workOrder: updated,
        todayLocal: input.todayLocal,
        actorPersonId: input.actorPersonId,
      });
    }

    return { ok: true, workOrder: updated } as const;
  });
}

/**
 * The one consequence a finished ticket has outside itself.
 *
 * A **fleet** ticket appends the unit's own `gear_service_events` row, so the
 * register's clocks move exactly as they would had a staffer logged the
 * service by hand — the whole reason a work order on the shop's own kit is not
 * a parallel system. A **customer** ticket sets each piece's `service_due_on`,
 * but only where it is empty or already past: a date staff have set for the
 * future is their call and is not overwritten.
 *
 * Soft goods move no clock, and nothing here is a gate: a shop that hands back
 * a regulator with no interval has an empty date, not a refusal.
 */
async function moveServiceClocks(
  tx: Parameters<Parameters<AppDb["transaction"]>[0]>[0],
  input: {
    shopId: string;
    workOrder: WorkOrder;
    todayLocal: CalendarDate;
    actorPersonId?: string;
  },
): Promise<void> {
  const { workOrder } = input;
  if (workOrder.gearItemId) {
    const [unit] = await tx
      .select({ kind: gearItems.kind })
      .from(gearItems)
      .where(and(eq(gearItems.id, workOrder.gearItemId), eq(gearItems.shopId, input.shopId)))
      .limit(1);
    if (!unit) return;
    const clock = workOrderServiceClock(unit.kind);
    if (!clock) return;
    await tx.insert(gearServiceEvents).values({
      shopId: input.shopId,
      gearItemId: workOrder.gearItemId,
      kind: clock,
      servicedOn: input.todayLocal,
      nextDueOn: suggestCustomerServiceDueOn(unit.kind, input.todayLocal),
      recordedByPersonId: input.actorPersonId ?? null,
      createdAt: nowDate(),
    });
    return;
  }

  const pieces = await tx
    .select({ id: customerGearItems.id, kind: customerGearItems.kind })
    .from(workOrderItems)
    .innerJoin(customerGearItems, eq(customerGearItems.id, workOrderItems.customerGearItemId))
    .where(eq(workOrderItems.workOrderId, workOrder.id));
  for (const piece of pieces) {
    const dueOn = suggestCustomerServiceDueOn(piece.kind, input.todayLocal);
    if (!dueOn) continue;
    await tx
      .update(customerGearItems)
      .set({ serviceDueOn: dueOn, updatedAt: nowDate() })
      .where(
        and(
          eq(customerGearItems.id, piece.id),
          sql`(${customerGearItems.serviceDueOn} is null or ${customerGearItems.serviceDueOn} <= ${input.todayLocal})`,
        ),
      );
  }
}

export type AssignTechnicianOutcome =
  | { ok: true; workOrder: WorkOrder }
  | { ok: false; reason: "not_found" };

/** Hand a ticket to a technician, or take it back off everybody. */
export async function assignWorkOrderTechnician(
  db: AppDb,
  input: {
    shopId: string;
    workOrderId: string;
    technicianPersonId: string | null;
    actorPersonId?: string;
  },
): Promise<AssignTechnicianOutcome> {
  return db.transaction(async (tx) => {
    const now = nowDate();
    const [updated] = await tx
      .update(workOrders)
      .set({ technicianPersonId: input.technicianPersonId, updatedAt: now })
      .where(
        and(
          eq(workOrders.id, input.workOrderId),
          eq(workOrders.shopId, input.shopId),
          liveWorkOrder(),
        ),
      )
      .returning();
    if (!updated) return { ok: false, reason: "not_found" } as const;
    await tx.insert(workOrderEvents).values({
      shopId: input.shopId,
      workOrderId: updated.id,
      kind: "technician_assigned",
      technicianPersonId: input.technicianPersonId,
      actorPersonId: input.actorPersonId ?? null,
      createdAt: now,
    });
    return { ok: true, workOrder: updated } as const;
  });
}

/**
 * Save the two prose fields. Bench notes and what the customer is told are
 * written on the same form and saved together, because a technician finishing
 * a job writes both in one sitting — and because keeping them in one write
 * keeps the staff-only half from ever being saved by a path that forgot it.
 */
export async function saveWorkOrderNotes(
  db: AppDb,
  input: {
    shopId: string;
    workOrderId: string;
    technicianNotes?: string;
    workPerformed?: string;
  },
): Promise<AssignTechnicianOutcome> {
  const [updated] = await db
    .update(workOrders)
    .set({
      technicianNotes: optional(input.technicianNotes),
      workPerformed: optional(input.workPerformed),
      updatedAt: nowDate(),
    })
    .where(
      and(
        eq(workOrders.id, input.workOrderId),
        eq(workOrders.shopId, input.shopId),
        liveWorkOrder(),
      ),
    )
    .returning();
  return updated ? { ok: true, workOrder: updated } : { ok: false, reason: "not_found" };
}

export type SaveWorkOrderDetailsOutcome =
  | { ok: true; workOrder: WorkOrder }
  | { ok: false; reason: "not_found" | "invalid_date" | "empty_problem" };

/** Edit what came in and when it was promised. */
export async function saveWorkOrderDetails(
  db: AppDb,
  input: {
    shopId: string;
    workOrderId: string;
    reportedProblem: string;
    promisedOn?: string;
  },
): Promise<SaveWorkOrderDetailsOutcome> {
  const reportedProblem = input.reportedProblem.trim();
  if (!reportedProblem) return { ok: false, reason: "empty_problem" };
  const promisedOn = optional(input.promisedOn);
  if (promisedOn && !isValidCalendarDate(promisedOn)) return { ok: false, reason: "invalid_date" };
  const [updated] = await db
    .update(workOrders)
    .set({ reportedProblem, promisedOn, updatedAt: nowDate() })
    .where(
      and(
        eq(workOrders.id, input.workOrderId),
        eq(workOrders.shopId, input.shopId),
        liveWorkOrder(),
      ),
    )
    .returning();
  return updated ? { ok: true, workOrder: updated } : { ok: false, reason: "not_found" };
}

export type DeleteWorkOrderOutcome =
  | { ok: true; deleted: WorkOrder }
  | { ok: false; reason: "not_found" };

/** Delete a ticket raised in error — soft, with who (ADR 20260820-every-delete-is-soft). */
export async function deleteWorkOrder(
  db: AppDb,
  input: { shopId: string; workOrderId: string; deletedByPersonId?: string },
): Promise<DeleteWorkOrderOutcome> {
  const now = nowDate();
  const [deleted] = await db
    .update(workOrders)
    .set({
      deletedAt: now,
      deletedByPersonId: input.deletedByPersonId ?? null,
      updatedAt: now,
    })
    .where(
      and(
        eq(workOrders.id, input.workOrderId),
        eq(workOrders.shopId, input.shopId),
        liveWorkOrder(),
      ),
    )
    .returning();
  return deleted ? { ok: true, deleted } : { ok: false, reason: "not_found" };
}

/** Put a deleted ticket back on the board. */
export async function restoreWorkOrder(
  db: AppDb,
  input: { shopId: string; workOrderId: string },
): Promise<DeleteWorkOrderOutcome> {
  const [restored] = await db
    .update(workOrders)
    .set({ deletedAt: null, deletedByPersonId: null, updatedAt: nowDate() })
    .where(and(eq(workOrders.id, input.workOrderId), eq(workOrders.shopId, input.shopId)))
    .returning();
  return restored ? { ok: true, deleted: restored } : { ok: false, reason: "not_found" };
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export type SaveWorkOrderLineOutcome =
  | { ok: true; line: WorkOrderLine }
  | {
      ok: false;
      reason: "not_found" | "empty_description" | "invalid_quantity" | "invalid_amount";
    };

function checkedLine(input: {
  description: string;
  quantityHundredths: number;
  unitAmountCents: number;
}): { reason: "empty_description" | "invalid_quantity" | "invalid_amount" } | null {
  if (!input.description.trim()) return { reason: "empty_description" };
  if (!Number.isInteger(input.quantityHundredths) || input.quantityHundredths <= 0) {
    return { reason: "invalid_quantity" };
  }
  if (
    !Number.isInteger(input.unitAmountCents) ||
    input.unitAmountCents < 0 ||
    input.unitAmountCents > WORK_ORDER_MAX_UNIT_AMOUNT_CENTS
  ) {
    return { reason: "invalid_amount" };
  }
  return null;
}

/** Add a part or an hour at the bench to a ticket. */
export async function addWorkOrderLine(
  db: AppDb,
  input: {
    shopId: string;
    workOrderId: string;
    kind: WorkOrderLineKindValue;
    description: string;
    quantityHundredths: number;
    unitAmountCents: number;
  },
): Promise<SaveWorkOrderLineOutcome> {
  const refused = checkedLine(input);
  if (refused) return { ok: false, ...refused };
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: workOrders.id })
      .from(workOrders)
      .where(
        and(
          eq(workOrders.id, input.workOrderId),
          eq(workOrders.shopId, input.shopId),
          liveWorkOrder(),
        ),
      )
      .limit(1);
    if (!order) return { ok: false, reason: "not_found" } as const;
    const [line] = await tx
      .insert(workOrderLines)
      .values({
        shopId: input.shopId,
        workOrderId: order.id,
        kind: input.kind,
        description: input.description.trim(),
        quantityHundredths: input.quantityHundredths,
        unitAmountCents: input.unitAmountCents,
      })
      .returning();
    return line ? ({ ok: true, line } as const) : ({ ok: false, reason: "not_found" } as const);
  });
}

/** Correct a line in place. */
export async function updateWorkOrderLine(
  db: AppDb,
  input: {
    shopId: string;
    workOrderLineId: string;
    kind: WorkOrderLineKindValue;
    description: string;
    quantityHundredths: number;
    unitAmountCents: number;
  },
): Promise<SaveWorkOrderLineOutcome> {
  const refused = checkedLine(input);
  if (refused) return { ok: false, ...refused };
  const [line] = await db
    .update(workOrderLines)
    .set({
      kind: input.kind,
      description: input.description.trim(),
      quantityHundredths: input.quantityHundredths,
      unitAmountCents: input.unitAmountCents,
      updatedAt: nowDate(),
    })
    .where(
      and(
        eq(workOrderLines.id, input.workOrderLineId),
        eq(workOrderLines.shopId, input.shopId),
        liveLine(),
      ),
    )
    .returning();
  return line ? { ok: true, line } : { ok: false, reason: "not_found" };
}

/** Delete a line — soft, so a ticket's quote keeps its own history. */
export async function deleteWorkOrderLine(
  db: AppDb,
  input: { shopId: string; workOrderLineId: string },
): Promise<SaveWorkOrderLineOutcome> {
  const [line] = await db
    .update(workOrderLines)
    .set({ deletedAt: nowDate(), updatedAt: nowDate() })
    .where(
      and(
        eq(workOrderLines.id, input.workOrderLineId),
        eq(workOrderLines.shopId, input.shopId),
        liveLine(),
      ),
    )
    .returning();
  return line ? { ok: true, line } : { ok: false, reason: "not_found" };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Live tickets, for the nav's presence check — gear shows for a shop with either. */
export async function countWorkOrders(db: AppDb, shopId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(workOrders)
    .where(and(eq(workOrders.shopId, shopId), liveWorkOrder()));
  return row?.value ?? 0;
}

export type WorkOrderBoardRow = {
  id: string;
  status: WorkOrderStatus;
  /** The diver whose gear it is, when the ticket is a customer's. */
  personId: string | null;
  personName: string | null;
  /** The shop's own unit, when it is a bench ticket. */
  gearItemId: string | null;
  gearItemLabel: string | null;
  reportedProblem: string;
  promisedOn: CalendarDate | null;
  late: boolean;
  technicianName: string | null;
  pieceCount: number;
  totalCents: number;
  receivedAt: Date;
};

export type WorkOrderBoardGroup = { status: WorkOrderStatus; rows: WorkOrderBoardRow[] };

/**
 * The board: every open ticket grouped by status in counter order, then the
 * most recently collected ones.
 *
 * Open groups are **not paged**, because the open set is the shop's actual
 * bench and a shop with more tickets open than fit on a page has a problem a
 * pager would hide. The collected group is capped instead, which is the half
 * that grows without bound.
 */
export async function workOrderBoard(
  db: AppDb,
  shopId: string,
  options: { todayLocal: CalendarDate; collectedLimit?: number },
): Promise<{ groups: WorkOrderBoardGroup[]; openCount: number }> {
  const collectedLimit = options.collectedLimit ?? 20;
  const technician = alias(people, "work_order_technician");
  const rows = await db
    .select({
      id: workOrders.id,
      status: workOrders.status,
      personId: workOrders.personId,
      personName: people.fullName,
      gearItemId: workOrders.gearItemId,
      gearItemLabel: gearItems.label,
      reportedProblem: workOrders.reportedProblem,
      promisedOn: workOrders.promisedOn,
      technicianName: technician.fullName,
      receivedAt: workOrders.receivedAt,
    })
    .from(workOrders)
    .leftJoin(people, eq(people.id, workOrders.personId))
    .leftJoin(gearItems, eq(gearItems.id, workOrders.gearItemId))
    .leftJoin(technician, eq(technician.id, workOrders.technicianPersonId))
    .where(and(eq(workOrders.shopId, shopId), liveWorkOrder()))
    .orderBy(desc(workOrders.receivedAt), asc(workOrders.reportedProblem), asc(workOrders.id));

  const open = rows.filter((row) => row.status !== "picked_up");
  const collected = rows.filter((row) => row.status === "picked_up").slice(0, collectedLimit);
  const shown = [...open, ...collected];
  const ids = shown.map((row) => row.id);
  const [totals, pieces] = await Promise.all([lineTotals(db, ids), pieceCounts(db, ids)]);

  const assembled: WorkOrderBoardRow[] = shown.map((row) => ({
    ...row,
    late: workOrderIsLate({
      status: row.status,
      promisedOn: row.promisedOn,
      todayLocal: options.todayLocal,
    }),
    pieceCount: pieces.get(row.id) ?? 0,
    totalCents: totals.get(row.id) ?? 0,
  }));

  const groups: WorkOrderBoardGroup[] = [];
  for (const status of [...new Set(assembled.map((row) => row.status))].sort(
    (left, right) => workOrderStatusRank(left) - workOrderStatusRank(right),
  )) {
    groups.push({ status, rows: assembled.filter((row) => row.status === status) });
  }
  return { groups, openCount: open.length };
}

/** The deleted tickets, newest first — the way back from a mistaken delete. */
export async function listDeletedWorkOrders(
  db: AppDb,
  shopId: string,
  options: { limit?: number } = {},
): Promise<{ id: string; reportedProblem: string; personName: string | null; deletedAt: Date }[]> {
  const rows = await db
    .select({
      id: workOrders.id,
      reportedProblem: workOrders.reportedProblem,
      personName: people.fullName,
      gearItemLabel: gearItems.label,
      deletedAt: workOrders.deletedAt,
    })
    .from(workOrders)
    .leftJoin(people, eq(people.id, workOrders.personId))
    .leftJoin(gearItems, eq(gearItems.id, workOrders.gearItemId))
    .where(and(eq(workOrders.shopId, shopId), sql`${workOrders.deletedAt} is not null`))
    .orderBy(desc(workOrders.deletedAt))
    .limit(options.limit ?? 25);
  return rows.map((row) => ({
    id: row.id,
    reportedProblem: row.reportedProblem,
    personName: row.personName ?? row.gearItemLabel,
    deletedAt: row.deletedAt ?? nowDate(),
  }));
}

async function lineTotals(db: AppDb, workOrderIds: string[]): Promise<Map<string, number>> {
  if (workOrderIds.length === 0) return new Map();
  const rows = await db
    .select({
      workOrderId: workOrderLines.workOrderId,
      quantityHundredths: workOrderLines.quantityHundredths,
      unitAmountCents: workOrderLines.unitAmountCents,
    })
    .from(workOrderLines)
    .where(and(inArray(workOrderLines.workOrderId, workOrderIds), liveLine()));
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.workOrderId, (totals.get(row.workOrderId) ?? 0) + workOrderLineTotalCents(row));
  }
  return totals;
}

async function pieceCounts(db: AppDb, workOrderIds: string[]): Promise<Map<string, number>> {
  if (workOrderIds.length === 0) return new Map();
  const rows = await db
    .select({ workOrderId: workOrderItems.workOrderId, value: count() })
    .from(workOrderItems)
    .where(inArray(workOrderItems.workOrderId, workOrderIds))
    .groupBy(workOrderItems.workOrderId);
  return new Map(rows.map((row) => [row.workOrderId, Number(row.value)]));
}

export type WorkOrderCustomer = {
  id: string;
  fullName: string;
  email: string | null;
  pieceCount: number;
};

/**
 * The new-ticket form's "whose gear is it?" search — the shop's own divers, by
 * the one predicate every staff person box uses (`personSearchMatch`), with
 * how many pieces each already has on file so the counter can tell two people
 * of the same name apart by what they own.
 */
export async function searchWorkOrderCustomers(
  db: AppDb,
  shopId: string,
  query: string,
  options: { limit?: number } = {},
): Promise<WorkOrderCustomer[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const rows = await db
    .selectDistinct({ id: people.id, fullName: people.fullName, email: people.email })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        eq(personRoles.role, "diver"),
        isNull(people.deletedAt),
        personSearchMatch(trimmed),
      ),
    )
    .orderBy(asc(people.fullName), asc(people.id))
    .limit(options.limit ?? 6);
  if (rows.length === 0) return [];
  const counts = await db
    .select({ personId: customerGearItems.personId, value: count() })
    .from(customerGearItems)
    .where(
      and(
        eq(customerGearItems.shopId, shopId),
        inArray(
          customerGearItems.personId,
          rows.map((row) => row.id),
        ),
        liveCustomerItem(),
      ),
    )
    .groupBy(customerGearItems.personId);
  const byPerson = new Map(counts.map((row) => [row.personId, Number(row.value)]));
  return rows.map((row) => ({ ...row, pieceCount: byPerson.get(row.id) ?? 0 }));
}

/** The shop's own units a bench ticket may be opened on, tag order. */
export async function listBenchUnits(
  db: AppDb,
  shopId: string,
): Promise<{ id: string; label: string; kind: GearItemKind }[]> {
  return db
    .select({ id: gearItems.id, label: gearItems.label, kind: gearItems.kind })
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), isNull(gearItems.deletedAt)))
    .orderBy(asc(gearItems.label));
}

export type WorkOrderDetail = {
  workOrder: WorkOrder;
  personName: string | null;
  gearItemLabel: string | null;
  gearItemKind: GearItemKind | null;
  technicianName: string | null;
  pieces: CustomerGearItem[];
  lines: WorkOrderLine[];
  totalCents: number;
  events: (WorkOrderEvent & { actorName: string | null; technicianName: string | null })[];
  late: boolean;
};

/**
 * One ticket, whole: its subject, the pieces on it, its lines and total, and
 * its history.
 *
 * Deliberately **not** filtered to live rows, like a unit's own record (ADR
 * 20260823, the amendment to 20260815-minimal-gear-register): a deleted ticket
 * stays readable, read-only, with the way back on it, because the shop may
 * still be asked what happened to that regulator.
 */
export async function getWorkOrderDetail(
  db: AppDb,
  shopId: string,
  workOrderId: string,
  options: { todayLocal: CalendarDate },
): Promise<WorkOrderDetail | null> {
  const technician = alias(people, "work_order_technician");
  const [row] = await db
    .select({
      workOrder: workOrders,
      personName: people.fullName,
      gearItemLabel: gearItems.label,
      gearItemKind: gearItems.kind,
      technicianName: technician.fullName,
    })
    .from(workOrders)
    .leftJoin(people, eq(people.id, workOrders.personId))
    .leftJoin(gearItems, eq(gearItems.id, workOrders.gearItemId))
    .leftJoin(technician, eq(technician.id, workOrders.technicianPersonId))
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.shopId, shopId)))
    .limit(1);
  if (!row) return null;

  const actor = alias(people, "work_order_actor");
  const eventTechnician = alias(people, "work_order_event_technician");
  const [pieces, lines, events] = await Promise.all([
    db
      .select({ item: customerGearItems })
      .from(workOrderItems)
      .innerJoin(customerGearItems, eq(customerGearItems.id, workOrderItems.customerGearItemId))
      // Shop-scoped as well as ticket-scoped: the parent was already checked
      // against this shop, and a child read that leans on that check is one
      // refactor away from being the hole.
      .where(and(eq(workOrderItems.workOrderId, workOrderId), eq(workOrderItems.shopId, shopId)))
      .orderBy(
        asc(customerGearItems.createdAt),
        asc(customerGearItems.kind),
        asc(customerGearItems.brandModel),
        asc(customerGearItems.id),
      ),
    db
      .select()
      .from(workOrderLines)
      .where(
        and(
          eq(workOrderLines.workOrderId, workOrderId),
          eq(workOrderLines.shopId, shopId),
          liveLine(),
        ),
      )
      .orderBy(
        asc(workOrderLines.createdAt),
        asc(workOrderLines.description),
        asc(workOrderLines.id),
      ),
    db
      .select({
        event: workOrderEvents,
        actorName: actor.fullName,
        technicianName: eventTechnician.fullName,
      })
      .from(workOrderEvents)
      .leftJoin(actor, eq(actor.id, workOrderEvents.actorPersonId))
      .leftJoin(eventTechnician, eq(eventTechnician.id, workOrderEvents.technicianPersonId))
      .where(and(eq(workOrderEvents.workOrderId, workOrderId), eq(workOrderEvents.shopId, shopId)))
      .orderBy(asc(workOrderEvents.seq)),
  ]);

  return {
    workOrder: row.workOrder,
    personName: row.personName,
    gearItemLabel: row.gearItemLabel,
    gearItemKind: row.gearItemKind,
    technicianName: row.technicianName,
    pieces: pieces.map((piece) => piece.item),
    lines,
    totalCents: workOrderTotalCents(lines),
    events: events.map((entry) => ({
      ...entry.event,
      actorName: entry.actorName,
      technicianName: entry.technicianName,
    })),
    late: workOrderIsLate({
      status: row.workOrder.status,
      promisedOn: row.workOrder.promisedOn,
      todayLocal: options.todayLocal,
    }),
  };
}

export type DiverWorkOrderRow = {
  id: string;
  status: WorkOrderStatus;
  reportedProblem: string;
  promisedOn: CalendarDate | null;
  late: boolean;
  receivedAt: Date;
};

/** One diver's own tickets, newest first — their section of the diver record. */
export async function listWorkOrdersForPerson(
  db: AppDb,
  shopId: string,
  personId: string,
  options: { todayLocal: CalendarDate; limit?: number },
): Promise<DiverWorkOrderRow[]> {
  const rows = await db
    .select({
      id: workOrders.id,
      status: workOrders.status,
      reportedProblem: workOrders.reportedProblem,
      promisedOn: workOrders.promisedOn,
      receivedAt: workOrders.receivedAt,
    })
    .from(workOrders)
    .where(and(eq(workOrders.shopId, shopId), eq(workOrders.personId, personId), liveWorkOrder()))
    .orderBy(desc(workOrders.receivedAt), asc(workOrders.reportedProblem), asc(workOrders.id))
    .limit(options.limit ?? 10);
  return rows.map((row) => ({
    ...row,
    late: workOrderIsLate({
      status: row.status,
      promisedOn: row.promisedOn,
      todayLocal: options.todayLocal,
    }),
  }));
}
