import { and, asc, count, desc, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { STAFF_ROLES } from "@/lib/authz";
import { type CalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { GearItemKind, GearItemStatus, GearServiceKind } from "@/lib/gear";
import {
  canMoveWorkOrder,
  customerDueField,
  customerDueFields,
  WORK_ORDER_MAX_UNIT_AMOUNT_CENTS,
  type WorkOrderOutcome,
  type WorkOrderStatus,
  type WorkOrderSubject,
  workOrderCareKinds,
  workOrderIsLate,
  workOrderLineTotalCents,
  workOrderOutcomeNeedsNote,
  workOrderReturnsUnitToService,
  workOrderStatusRank,
  workOrderTotalCents,
} from "@/lib/work-orders";
import type { AppDb, DbExecutor } from "./client";
import { recordGearService, setGearItemStatus } from "./gear";
import { personSearchMatch } from "./person-search";
import {
  type CustomerGearItem,
  customerGearItems,
  gearItems,
  people,
  personRoles,
  shops,
  type WorkOrder,
  type WorkOrderCare,
  type WorkOrderEvent,
  type WorkOrderLine,
  type WorkOrderLineKindValue,
  workOrderCare,
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
 * - **No status move writes a clock.** Only the technician's "Work done"
 *   record (`recordWorkOrderWork`) does: each passed check on a shop unit goes
 *   through the register's own `recordGearService`, each on a customer's piece
 *   sets the matching due date from the day it was performed. Pickup writes
 *   nothing, and a job declined, unserviceable or condemned writes no clock.
 * - **A shop unit on the bench is out of the pool.** Opening a ticket on it
 *   sets it to `needs_service` with the reported problem as its note, through
 *   the register's own `setGearItemStatus`; deleting the ticket puts back what
 *   opening it changed.
 *
 * And one rule about people: every person a write names — the customer, the
 * technician — is checked against this shop inside the write, never trusted
 * off a form, and every read that joins a name joins it within the shop.
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

/** Whose gear a ticket is about, read off the row. */
function subjectOf(workOrder: Pick<WorkOrder, "gearItemId">): WorkOrderSubject {
  return workOrder.gearItemId ? "unit" : "customer";
}

/**
 * **A person a ticket may be about**: this shop's, not removed, not erased.
 * Writing a piece or a ticket onto a diver the shop erased would put fresh
 * personal records under a name the shop promised was gone.
 */
async function isLivePersonAt(tx: DbExecutor, shopId: string, personId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.id, personId),
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** **A person who may hold a ticket**: a live member of this shop's staff. */
async function isStaffAt(tx: DbExecutor, shopId: string, personId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.id, personId),
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Keep only the dates a piece of this kind has: a cylinder's two, or the one
 * service date. A date for the other shape is dropped rather than stored, so a
 * tank can never carry a "service due" nobody would act on.
 */
function piecesDates(
  kind: GearItemKind,
  input: { serviceDueOn?: string; inspectionDueOn?: string; hydroDueOn?: string },
):
  | { serviceDueOn: string | null; inspectionDueOn: string | null; hydroDueOn: string | null }
  | "invalid_date" {
  const kept = customerDueFields(kind);
  const dates = {
    serviceDueOn: kept.includes("serviceDueOn") ? optional(input.serviceDueOn) : null,
    inspectionDueOn: kept.includes("inspectionDueOn") ? optional(input.inspectionDueOn) : null,
    hydroDueOn: kept.includes("hydroDueOn") ? optional(input.hydroDueOn) : null,
  };
  for (const value of Object.values(dates)) {
    if (value && !isValidCalendarDate(value)) return "invalid_date";
  }
  return dates;
}

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
  /** A cylinder's next visual inspection; ignored on any other kind. */
  inspectionDueOn?: string;
  /** A cylinder's next hydro test; ignored on any other kind. */
  hydroDueOn?: string;
};

export type SaveCustomerGearItemOutcome =
  | { ok: true; item: CustomerGearItem }
  | { ok: false; reason: "not_found" | "invalid_date" };

/**
 * Record one piece of a diver's own kit on their record. The diver is checked
 * against this shop inside the write: a person id is never trusted off a form.
 */
export async function addCustomerGearItem(
  db: AppDb,
  input: CustomerGearItemInput,
): Promise<SaveCustomerGearItemOutcome> {
  const dates = piecesDates(input.kind, input);
  if (dates === "invalid_date") return { ok: false, reason: "invalid_date" };
  return db.transaction(async (tx) => {
    if (!(await isLivePersonAt(tx, input.shopId, input.personId))) {
      return { ok: false, reason: "not_found" } as const;
    }
    const [item] = await tx
      .insert(customerGearItems)
      .values({
        shopId: input.shopId,
        personId: input.personId,
        kind: input.kind,
        brandModel: optional(input.brandModel),
        serialNumber: optional(input.serialNumber),
        note: optional(input.note),
        ...dates,
      })
      .returning();
    return item ? ({ ok: true, item } as const) : ({ ok: false, reason: "not_found" } as const);
  });
}

/**
 * Edit a piece, including the dates a recorded job set. Refused on a diver the
 * shop has removed or erased, for the reason adding one is.
 */
export async function updateCustomerGearItem(
  db: AppDb,
  input: Omit<CustomerGearItemInput, "personId"> & { customerGearItemId: string },
): Promise<SaveCustomerGearItemOutcome> {
  const dates = piecesDates(input.kind, input);
  if (dates === "invalid_date") return { ok: false, reason: "invalid_date" };
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ personId: customerGearItems.personId })
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
    if (!current || !(await isLivePersonAt(tx, input.shopId, current.personId))) {
      return { ok: false, reason: "not_found" } as const;
    }
    const [item] = await tx
      .update(customerGearItems)
      .set({
        kind: input.kind,
        brandModel: optional(input.brandModel),
        serialNumber: optional(input.serialNumber),
        note: optional(input.note),
        ...dates,
        updatedAt: nowDate(),
      })
      .where(eq(customerGearItems.id, input.customerGearItemId))
      .returning();
    return item ? ({ ok: true, item } as const) : ({ ok: false, reason: "not_found" } as const);
  });
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
        | "unknown_technician"
        | "no_items";
    };

/**
 * Open a ticket. One subject, at least one piece when that subject is a
 * customer, and a `created` history row — all in one transaction, so a ticket
 * never exists without the drop-off it records.
 *
 * The customer must be a live person of this shop and the technician a live
 * member of its staff, both checked here. A shop unit is taken off the wall in
 * the same write: `needs_service`, with the reported problem as its note, and
 * what it was before kept on the ticket so a delete can put it back.
 *
 * The ticket number is the shop's next, under a lock on the shop's row so two
 * counters opening tickets at once cannot both take #12.
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
    if (
      input.technicianPersonId &&
      !(await isStaffAt(tx, input.shopId, input.technicianPersonId))
    ) {
      return { ok: false, reason: "unknown_technician" } as const;
    }

    let unit: { id: string; status: GearItemStatus; serviceNote: string | null } | undefined;
    if (input.gearItemId) {
      [unit] = await tx
        .select({ id: gearItems.id, status: gearItems.status, serviceNote: gearItems.serviceNote })
        .from(gearItems)
        .where(
          and(
            eq(gearItems.id, input.gearItemId),
            eq(gearItems.shopId, input.shopId),
            isNull(gearItems.deletedAt),
          ),
        )
        .limit(1)
        .for("update");
      if (!unit) return { ok: false, reason: "not_found" } as const;
    }

    if (input.personId) {
      if (!(await isLivePersonAt(tx, input.shopId, input.personId))) {
        return { ok: false, reason: "not_found" } as const;
      }
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

    // The shop's row is the lock: ticket numbers are per shop and never reused.
    await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, input.shopId)).for("update");
    const [highest] = await tx
      .select({ value: max(workOrders.number) })
      .from(workOrders)
      .where(eq(workOrders.shopId, input.shopId));

    const [workOrder] = await tx
      .insert(workOrders)
      .values({
        shopId: input.shopId,
        number: (highest?.value ?? 0) + 1,
        personId: input.personId ?? null,
        gearItemId: input.gearItemId ?? null,
        status: "received",
        reportedProblem,
        promisedOn,
        technicianPersonId: input.technicianPersonId ?? null,
        unitPriorStatus: unit?.status ?? null,
        unitPriorServiceNote: unit?.serviceNote ?? null,
        receivedAt: nowDate(),
      })
      .returning();
    if (!workOrder) return { ok: false, reason: "not_found" } as const;

    if (unit) {
      await pullUnitOffTheWall(tx, input.shopId, unit.id, reportedProblem);
    }

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
 * Move a ticket and stamp what the move means. **Nothing else.** A move —
 * pickup included — never writes a clock or changes a unit's status: that is
 * the "Work done" record's job (`recordWorkOrderWork`), and only with what the
 * technician confirmed.
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
    if (!canMoveWorkOrder(current.status, input.status, subjectOf(current))) {
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

    return { ok: true, workOrder: updated } as const;
  });
}

/**
 * Take a shop unit off the wall for the bench: `needs_service`, with the
 * reported problem as the note a packer reads, through the register's own
 * writer so the register and the ticket cannot disagree about how.
 */
async function pullUnitOffTheWall(
  tx: DbExecutor,
  shopId: string,
  gearItemId: string,
  reportedProblem: string,
): Promise<void> {
  await setGearItemStatus(tx, {
    shopId,
    gearItemId,
    status: "needs_service",
    serviceNote: reportedProblem,
  });
}

export type SaveWorkOrderOutcome =
  | { ok: true; workOrder: WorkOrder }
  | {
      ok: false;
      reason: "not_found" | "invalid_date" | "empty_problem" | "unknown_technician";
    };

/**
 * **Save the ticket's record in one write**: what came in, the day promised,
 * who has it, the bench notes and what the customer is told.
 *
 * One form and one Save on the ticket, so one transaction here — a half-saved
 * ticket (the notes but not the technician) is the state a single write rules
 * out. A hand-over is still its own history row, written only when the
 * technician actually changes, so saving the notes is never mistaken for
 * handing the ticket on.
 *
 * The technician must be a live member of this shop's staff, and a customer's
 * ticket must still be about a live person of this shop: the shop does not
 * keep writing onto a diver it has erased.
 */
export async function saveWorkOrder(
  db: AppDb,
  input: {
    shopId: string;
    workOrderId: string;
    reportedProblem: string;
    promisedOn?: string;
    technicianPersonId: string | null;
    technicianNotes?: string;
    workPerformed?: string;
    actorPersonId?: string;
  },
): Promise<SaveWorkOrderOutcome> {
  const reportedProblem = input.reportedProblem.trim();
  if (!reportedProblem) return { ok: false, reason: "empty_problem" };
  const promisedOn = optional(input.promisedOn);
  if (promisedOn && !isValidCalendarDate(promisedOn)) return { ok: false, reason: "invalid_date" };

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
    if (current.personId && !(await isLivePersonAt(tx, input.shopId, current.personId))) {
      return { ok: false, reason: "not_found" } as const;
    }
    const technicianChanged = current.technicianPersonId !== input.technicianPersonId;
    if (
      technicianChanged &&
      input.technicianPersonId &&
      !(await isStaffAt(tx, input.shopId, input.technicianPersonId))
    ) {
      return { ok: false, reason: "unknown_technician" } as const;
    }

    const now = nowDate();
    const [updated] = await tx
      .update(workOrders)
      .set({
        reportedProblem,
        promisedOn,
        technicianPersonId: input.technicianPersonId,
        technicianNotes: optional(input.technicianNotes),
        workPerformed: optional(input.workPerformed),
        updatedAt: now,
      })
      .where(eq(workOrders.id, current.id))
      .returning();
    if (!updated) return { ok: false, reason: "not_found" } as const;

    if (technicianChanged) {
      await tx.insert(workOrderEvents).values({
        shopId: input.shopId,
        workOrderId: current.id,
        kind: "technician_assigned",
        technicianPersonId: input.technicianPersonId,
        actorPersonId: input.actorPersonId ?? null,
        createdAt: now,
      });
    }
    return { ok: true, workOrder: updated } as const;
  });
}

/** One check a technician records: which care, on which piece, and how it came out. */
export type WorkOrderCareInput = {
  /** The customer's piece it was done on; omitted on a shop unit's ticket. */
  customerGearItemId?: string | null;
  kind: GearServiceKind;
  passed: boolean;
  /** The day the work was performed, in the shop's calendar. */
  performedOn: string;
  /** The next due date the technician confirmed; only on a passed check. */
  nextDueOn?: string;
  /** A shop unit's dive interval, beside a date; only on a passed check. */
  nextDueDives?: number;
};

export type RecordWorkOrderWorkOutcome =
  | { ok: true; workOrder: WorkOrder }
  | {
      ok: false;
      reason:
        | "not_found"
        | "closed"
        | "already_recorded"
        | "no_care"
        | "care_on_not_done"
        | "note_required"
        | "invalid_care"
        | "invalid_date"
        | "future_date"
        | "due_not_after_performed"
        | "invalid_dives";
    };

/** The checks a `recordWorkOrderWork` call can refuse before it opens a transaction. */
function checkedCare(
  care: readonly WorkOrderCareInput[],
  todayLocal: CalendarDate,
): Exclude<RecordWorkOrderWorkOutcome, { ok: true }>["reason"] | null {
  const seen = new Set<string>();
  for (const row of care) {
    const key = `${row.customerGearItemId ?? "unit"}:${row.kind}`;
    if (seen.has(key)) return "invalid_care";
    seen.add(key);
    const performedOn = row.performedOn.trim();
    const nextDueOn = optional(row.nextDueOn);
    if (!isValidCalendarDate(performedOn)) return "invalid_date";
    if (nextDueOn && !isValidCalendarDate(nextDueOn)) return "invalid_date";
    // Work recorded as done on a day still to come is a typo, and one that
    // would start a clock from a date the gear has not reached.
    if (performedOn > todayLocal) return "future_date";
    if (!row.passed && (nextDueOn || row.nextDueDives !== undefined)) return "invalid_care";
    if (nextDueOn && nextDueOn <= performedOn) return "due_not_after_performed";
    if (row.nextDueDives !== undefined) {
      if (!Number.isInteger(row.nextDueDives) || row.nextDueDives <= 0) return "invalid_dives";
      if (!nextDueOn) return "invalid_dives";
    }
    if (row.kind === "note" && (nextDueOn || row.nextDueDives !== undefined)) {
      return "invalid_care";
    }
  }
  return null;
}

/**
 * **The "Work done" record** — the only path from a ticket to a clock.
 *
 * The technician says how the job ended and, when it was done, each check they
 * performed: which care, on which piece, passed or failed, the day they did
 * it, and the next due date they confirm. Then, in one transaction:
 *
 * - **A shop unit**: each *passed* check is written through the register's own
 *   `recordGearService` — its validation, its dive interval, its history — and
 *   the unit goes back on the wall (`returnToService`) only when every check
 *   passed and one of them is the care that answers a concern on that kind of
 *   unit. A failed check writes no clock: a failed hydro must never read as a
 *   fresh one. A job condemned or unserviceable leaves the unit off the wall
 *   with the technician's reason as its service note; a declined job leaves it
 *   exactly as it was.
 * - **A customer's piece**: each passed check sets the matching date (service,
 *   or a cylinder's inspection or hydro) to what the technician confirmed,
 *   replacing whatever was there — the recorded work is newer than any date
 *   staff typed before it.
 *
 * Recorded once. A collected ticket refuses, as does one already recorded.
 */
export async function recordWorkOrderWork(
  db: AppDb,
  input: {
    shopId: string;
    workOrderId: string;
    outcome: WorkOrderOutcome;
    outcomeNote?: string;
    care: readonly WorkOrderCareInput[];
    todayLocal: CalendarDate;
    actorPersonId?: string;
  },
): Promise<RecordWorkOrderWorkOutcome> {
  const outcomeNote = optional(input.outcomeNote);
  if (input.outcome === "done" && input.care.length === 0) return { ok: false, reason: "no_care" };
  if (input.outcome !== "done" && input.care.length > 0) {
    return { ok: false, reason: "care_on_not_done" };
  }
  if (workOrderOutcomeNeedsNote(input.outcome) && !outcomeNote) {
    return { ok: false, reason: "note_required" };
  }
  const refused = checkedCare(input.care, input.todayLocal);
  if (refused) return { ok: false, reason: refused };

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
    if (current.status === "picked_up") return { ok: false, reason: "closed" } as const;
    if (current.outcome !== null) return { ok: false, reason: "already_recorded" } as const;

    // Every check must be about this ticket's own subject, and a care its
    // kind of gear actually has.
    let unitKind: GearItemKind | null = null;
    if (current.gearItemId) {
      const [unit] = await tx
        .select({ kind: gearItems.kind })
        .from(gearItems)
        .where(
          and(
            eq(gearItems.id, current.gearItemId),
            eq(gearItems.shopId, input.shopId),
            isNull(gearItems.deletedAt),
          ),
        )
        .limit(1)
        .for("update");
      if (!unit) return { ok: false, reason: "not_found" } as const;
      unitKind = unit.kind;
      for (const row of input.care) {
        if (row.customerGearItemId) return { ok: false, reason: "invalid_care" } as const;
        if (!workOrderCareKinds(unit.kind).includes(row.kind)) {
          return { ok: false, reason: "invalid_care" } as const;
        }
      }
    } else {
      if (!current.personId || !(await isLivePersonAt(tx, input.shopId, current.personId))) {
        return { ok: false, reason: "not_found" } as const;
      }
      const pieces = await tx
        .select({ id: customerGearItems.id, kind: customerGearItems.kind })
        .from(workOrderItems)
        .innerJoin(customerGearItems, eq(customerGearItems.id, workOrderItems.customerGearItemId))
        .where(
          and(eq(workOrderItems.workOrderId, current.id), eq(workOrderItems.shopId, input.shopId)),
        );
      const kindById = new Map(pieces.map((piece) => [piece.id, piece.kind]));
      for (const row of input.care) {
        const kind = row.customerGearItemId ? kindById.get(row.customerGearItemId) : undefined;
        if (!kind || !workOrderCareKinds(kind).includes(row.kind)) {
          return { ok: false, reason: "invalid_care" } as const;
        }
        if (row.nextDueDives !== undefined) return { ok: false, reason: "invalid_care" } as const;
      }
    }

    const now = nowDate();
    if (input.care.length > 0) {
      await tx.insert(workOrderCare).values(
        input.care.map((row) => ({
          shopId: input.shopId,
          workOrderId: current.id,
          customerGearItemId: row.customerGearItemId ?? null,
          kind: row.kind,
          passed: row.passed,
          performedOn: row.performedOn.trim(),
          nextDueOn: row.passed ? optional(row.nextDueOn) : null,
          nextDueDives: row.passed ? (row.nextDueDives ?? null) : null,
          createdAt: now,
        })),
      );
    }

    const [updated] = await tx
      .update(workOrders)
      .set({
        outcome: input.outcome,
        outcomeNote,
        outcomeRecordedAt: now,
        outcomeRecordedByPersonId: input.actorPersonId ?? null,
        updatedAt: now,
      })
      .where(eq(workOrders.id, current.id))
      .returning();
    if (!updated) return { ok: false, reason: "not_found" } as const;

    await tx.insert(workOrderEvents).values({
      shopId: input.shopId,
      workOrderId: current.id,
      kind: "work_recorded",
      actorPersonId: input.actorPersonId ?? null,
      createdAt: now,
    });

    if (current.gearItemId && unitKind) {
      await writeUnitCare(tx, {
        shopId: input.shopId,
        gearItemId: current.gearItemId,
        unitKind,
        outcome: input.outcome,
        outcomeNote,
        care: input.care,
        actorPersonId: input.actorPersonId,
      });
    } else if (input.outcome === "done") {
      for (const row of input.care) {
        const field = customerDueField(row.kind);
        if (!row.passed || !field || !row.customerGearItemId) continue;
        await tx
          .update(customerGearItems)
          .set({ [field]: optional(row.nextDueOn), updatedAt: now })
          .where(
            and(
              eq(customerGearItems.id, row.customerGearItemId),
              eq(customerGearItems.shopId, input.shopId),
            ),
          );
      }
    }

    return { ok: true, workOrder: updated } as const;
  });
}

/**
 * A shop unit's half of the Work done record, through the register's own
 * writers. Separate so the rule reads in one place: passed checks become
 * service events, the unit returns only on a clean job that answers its
 * concern, and a condemned or unserviceable job keeps it off the wall with
 * the reason as its note.
 */
async function writeUnitCare(
  tx: DbExecutor,
  input: {
    shopId: string;
    gearItemId: string;
    unitKind: GearItemKind;
    outcome: WorkOrderOutcome;
    outcomeNote: string | null;
    care: readonly WorkOrderCareInput[];
    actorPersonId?: string;
  },
): Promise<void> {
  if (input.outcome === "condemned" || input.outcome === "unserviceable") {
    await setGearItemStatus(tx, {
      shopId: input.shopId,
      gearItemId: input.gearItemId,
      status: "needs_service",
      serviceNote: input.outcomeNote ?? undefined,
    });
    return;
  }
  if (input.outcome !== "done") return;

  const returns = workOrderReturnsUnitToService(input.unitKind, input.care);
  const passed = input.care.filter((row) => row.passed);
  for (const [index, row] of passed.entries()) {
    const outcome = await recordGearService(tx, {
      shopId: input.shopId,
      gearItemId: input.gearItemId,
      kind: row.kind,
      servicedOn: row.performedOn.trim(),
      nextDueOn: row.nextDueOn,
      nextDueDives: row.nextDueDives,
      recordedByPersonId: input.actorPersonId,
      // The last passed check carries the return, so the unit is back on the
      // wall only once every clock it earned is written.
      returnToService: returns && index === passed.length - 1,
    });
    // The rules were checked above against the same row; a refusal here is a
    // bug, and the transaction must not commit half a record.
    if (!outcome.ok) throw new Error(`recordGearService refused a checked row: ${outcome.reason}`);
  }
}

export type DeleteWorkOrderOutcome =
  | { ok: true; deleted: WorkOrder }
  | { ok: false; reason: "not_found" };

/**
 * Delete a ticket raised in error — soft, with who (ADR
 * 20260820-every-delete-is-soft).
 *
 * **Symmetric for a shop unit.** Opening the ticket took the unit off the wall;
 * deleting it puts back what it was before — but only while nothing else has
 * spoken for the unit since: no work recorded on this ticket and its note
 * still the one this ticket wrote. While another open ticket holds the unit it
 * never goes back in service; it only gets that earlier hold's words back.
 */
export async function deleteWorkOrder(
  db: AppDb,
  input: { shopId: string; workOrderId: string; deletedByPersonId?: string },
): Promise<DeleteWorkOrderOutcome> {
  return db.transaction(async (tx) => {
    const now = nowDate();
    const [deleted] = await tx
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
    if (!deleted) return { ok: false, reason: "not_found" } as const;
    if (deleted.gearItemId && deleted.outcome === null && deleted.unitPriorStatus) {
      await putUnitBack(tx, deleted, deleted.gearItemId, deleted.unitPriorStatus);
    }
    return { ok: true, deleted } as const;
  });
}

async function putUnitBack(
  tx: DbExecutor,
  ticket: WorkOrder,
  gearItemId: string,
  priorStatus: GearItemStatus,
): Promise<void> {
  const [unit] = await tx
    .select({ status: gearItems.status, serviceNote: gearItems.serviceNote })
    .from(gearItems)
    .where(and(eq(gearItems.id, gearItemId), eq(gearItems.shopId, ticket.shopId)))
    .limit(1)
    .for("update");
  if (unit?.status !== "needs_service" || unit.serviceNote !== ticket.reportedProblem) {
    return;
  }
  const [otherOpen] = await tx
    .select({ value: count() })
    .from(workOrders)
    .where(
      and(
        eq(workOrders.shopId, ticket.shopId),
        eq(workOrders.gearItemId, gearItemId),
        ne(workOrders.id, ticket.id),
        liveWorkOrder(),
        ne(workOrders.status, "picked_up"),
      ),
    );
  // Another open ticket still holds the unit: it stays off the wall, and only
  // a prior hold's own words come back. Nothing puts it in service early.
  if ((otherOpen?.value ?? 0) > 0 && priorStatus !== "needs_service") return;
  await setGearItemStatus(tx, {
    shopId: ticket.shopId,
    gearItemId,
    status: priorStatus,
    serviceNote: ticket.unitPriorServiceNote ?? undefined,
  });
}

/**
 * Put a deleted ticket back on the board — and, for an open shop-unit ticket
 * with no work recorded, take the unit off the wall again, keeping what it is
 * now as what a later delete puts back.
 */
export async function restoreWorkOrder(
  db: AppDb,
  input: { shopId: string; workOrderId: string },
): Promise<DeleteWorkOrderOutcome> {
  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .select()
      .from(workOrders)
      .where(and(eq(workOrders.id, input.workOrderId), eq(workOrders.shopId, input.shopId)))
      .limit(1)
      .for("update");
    if (!ticket) return { ok: false, reason: "not_found" } as const;

    let prior: { status: GearItemStatus; serviceNote: string | null } | undefined;
    const pulls =
      ticket.deletedAt !== null &&
      ticket.gearItemId !== null &&
      ticket.outcome === null &&
      ticket.status !== "picked_up";
    if (pulls && ticket.gearItemId) {
      [prior] = await tx
        .select({ status: gearItems.status, serviceNote: gearItems.serviceNote })
        .from(gearItems)
        .where(
          and(
            eq(gearItems.id, ticket.gearItemId),
            eq(gearItems.shopId, input.shopId),
            isNull(gearItems.deletedAt),
          ),
        )
        .limit(1)
        .for("update");
    }

    const [restored] = await tx
      .update(workOrders)
      .set({
        deletedAt: null,
        deletedByPersonId: null,
        ...(prior
          ? { unitPriorStatus: prior.status, unitPriorServiceNote: prior.serviceNote }
          : {}),
        updatedAt: nowDate(),
      })
      .where(eq(workOrders.id, ticket.id))
      .returning();
    if (!restored) return { ok: false, reason: "not_found" } as const;
    if (prior && ticket.gearItemId) {
      await pullUnitOffTheWall(tx, input.shopId, ticket.gearItemId, ticket.reportedProblem);
    }
    return { ok: true, deleted: restored } as const;
  });
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
  /** The shop's ticket number, what the tag and a phone call use. */
  number: number;
  status: WorkOrderStatus;
  /** How the job ended, once the Work done record says so. */
  outcome: WorkOrderOutcome | null;
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
      number: workOrders.number,
      status: workOrders.status,
      outcome: workOrders.outcome,
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
    // Every join is within the ticket's own shop, so a foreign id that ever
    // reached a column renders as nobody rather than as somebody else's name.
    .leftJoin(people, and(eq(people.id, workOrders.personId), eq(people.shopId, workOrders.shopId)))
    .leftJoin(
      gearItems,
      and(eq(gearItems.id, workOrders.gearItemId), eq(gearItems.shopId, workOrders.shopId)),
    )
    .leftJoin(
      technician,
      and(
        eq(technician.id, workOrders.technicianPersonId),
        eq(technician.shopId, workOrders.shopId),
      ),
    )
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
    .leftJoin(people, and(eq(people.id, workOrders.personId), eq(people.shopId, workOrders.shopId)))
    .leftJoin(
      gearItems,
      and(eq(gearItems.id, workOrders.gearItemId), eq(gearItems.shopId, workOrders.shopId)),
    )
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
  subject: WorkOrderSubject;
  personName: string | null;
  gearItemLabel: string | null;
  gearItemKind: GearItemKind | null;
  /** A shop unit's register status now, and the note a packer reads. */
  gearItemStatus: GearItemStatus | null;
  gearItemServiceNote: string | null;
  technicianName: string | null;
  pieces: CustomerGearItem[];
  /** The Work done record's checks, once recorded. */
  care: WorkOrderCare[];
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
      gearItemStatus: gearItems.status,
      gearItemServiceNote: gearItems.serviceNote,
      technicianName: technician.fullName,
    })
    .from(workOrders)
    // Every join is within the ticket's own shop, so a foreign id that ever
    // reached a column renders as nobody rather than as somebody else's name.
    .leftJoin(people, and(eq(people.id, workOrders.personId), eq(people.shopId, workOrders.shopId)))
    .leftJoin(
      gearItems,
      and(eq(gearItems.id, workOrders.gearItemId), eq(gearItems.shopId, workOrders.shopId)),
    )
    .leftJoin(
      technician,
      and(
        eq(technician.id, workOrders.technicianPersonId),
        eq(technician.shopId, workOrders.shopId),
      ),
    )
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.shopId, shopId)))
    .limit(1);
  if (!row) return null;

  const actor = alias(people, "work_order_actor");
  const eventTechnician = alias(people, "work_order_event_technician");
  const [pieces, lines, events, care] = await Promise.all([
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
      .leftJoin(
        actor,
        and(eq(actor.id, workOrderEvents.actorPersonId), eq(actor.shopId, workOrderEvents.shopId)),
      )
      .leftJoin(
        eventTechnician,
        and(
          eq(eventTechnician.id, workOrderEvents.technicianPersonId),
          eq(eventTechnician.shopId, workOrderEvents.shopId),
        ),
      )
      .where(and(eq(workOrderEvents.workOrderId, workOrderId), eq(workOrderEvents.shopId, shopId)))
      .orderBy(asc(workOrderEvents.seq)),
    db
      .select()
      .from(workOrderCare)
      .where(and(eq(workOrderCare.workOrderId, workOrderId), eq(workOrderCare.shopId, shopId)))
      .orderBy(
        asc(workOrderCare.createdAt),
        asc(workOrderCare.customerGearItemId),
        asc(workOrderCare.kind),
        asc(workOrderCare.id),
      ),
  ]);

  return {
    workOrder: row.workOrder,
    subject: subjectOf(row.workOrder),
    personName: row.personName,
    gearItemLabel: row.gearItemLabel,
    gearItemKind: row.gearItemKind,
    gearItemStatus: row.gearItemStatus,
    gearItemServiceNote: row.gearItemServiceNote,
    technicianName: row.technicianName,
    pieces: pieces.map((piece) => piece.item),
    care,
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
  number: number;
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
      number: workOrders.number,
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
