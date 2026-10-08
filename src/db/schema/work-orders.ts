import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { people, shops } from "./core";
import { gearItemKind, gearItemStatus, gearItems, gearServiceKind } from "./gear";

/**
 * Service work orders: a customer's own gear brought in for work, the ticket a
 * technician works, and the parts and labor on it
 * (ADR 20261008-gear-work-orders, which reverses the vision's "no repair work
 * orders" non-goal).
 *
 * Built on the register's vocabulary rather than beside it: a customer item
 * carries the same `gear_item_kind` as a fleet unit, and the care a technician
 * records on a *fleet* unit's ticket is written through the register's own
 * `recordGearService`, so the service clocks a shop already reads keep
 * working. **No status move writes a clock.** Only the technician's explicit
 * "Work done" record does (`work_order_care`), with the dates they confirm.
 * What stays declined is retail: no parts catalog and no stock counting
 * ([vision.md](../../../docs/product/vision.md)).
 */

/**
 * Where a ticket is, in the order the counter says them. `received` is the
 * drop-off, `ready` is the one the customer is waiting for, and `picked_up`
 * closes it. `waiting_on_parts` is deliberately its own answer rather than a
 * flag on `in_progress`: it is the status a shop is asked about by name, and
 * the one nobody at the bench can move.
 *
 * There is no `cancelled`. A ticket raised by mistake is *deleted*, soft like
 * every other delete (ADR 20260820-every-delete-is-soft), and one the customer
 * calls off is collected — `picked_up` with nothing performed.
 */
export const workOrderStatus = pgEnum("work_order_status", [
  "received",
  "in_progress",
  "waiting_on_parts",
  "ready",
  "picked_up",
]);

/** What a line on the ticket is: a part fitted, or bench time. */
export const workOrderLineKind = pgEnum("work_order_line_kind", ["part", "labor"]);

/**
 * What a history row records: the ticket opening, a status move, a hand-over
 * to a technician, or the technician's "Work done" record.
 */
export const workOrderEventKind = pgEnum("work_order_event_kind", [
  "created",
  "status_changed",
  "technician_assigned",
  "work_recorded",
]);

/**
 * **How the job ended**, which the technician says in so many words. `done`
 * is the only outcome that carries care rows (`work_order_care`) and the only
 * one that can move a clock; the other three write nothing to any clock.
 * `declined` is the customer saying no to the quote, `unserviceable` is gear
 * that cannot be fixed here (no parts, out of the shop's scope), and
 * `condemned` is gear that must not be dived again — a failed hydro, a cracked
 * first stage. A condemned shop unit stays out of the pool with the reason as
 * its service note.
 */
export const workOrderOutcome = pgEnum("work_order_outcome", [
  "done",
  "declined",
  "unserviceable",
  "condemned",
]);

/**
 * One piece of a customer's **own** gear, recorded once on their record so the
 * next drop-off does not retype it. Never the shop's fleet — that is
 * `gear_items` — and never a rental fit: `rental_fit_profiles` says what sizes
 * a diver takes *from* the shop.
 *
 * A customer item runs dates rather than the fleet's append-only event
 * history: a shop owes a customer a reminder, not a compliance record it can
 * be audited on. Most kinds have one (`service_due_on`); a cylinder has its
 * two compliance dates instead (`inspection_due_on`, `hydro_due_on`) and never
 * a "service". A care row the technician records as passed sets the matching
 * date from the date the work was *performed*, replacing whatever was there;
 * with no recorded care, a date staff set stands.
 */
export const customerGearItems = pgTable(
  "customer_gear_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    kind: gearItemKind("kind").notNull(),
    /** One free-text field ("Apeks XTX200"), exactly like the register's. Never a catalog. */
    brandModel: text("brand_model"),
    serialNumber: text("serial_number"),
    /** Staff free text ("second stage is the customer's spare"). */
    note: text("note"),
    /** When this piece is next due for service, in the shop's own calendar. Never a cylinder's. */
    serviceDueOn: date("service_due_on"),
    /** A cylinder's next visual inspection (VIP). A cylinder has two dates and no "service". */
    inspectionDueOn: date("inspection_due_on"),
    /** A cylinder's next hydrostatic test. */
    hydroDueOn: date("hydro_due_on"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Partial on the live rows, like the register's: every read that means
    // "this diver's gear" carries `deleted_at is null`.
    index("customer_gear_items_shop_person_idx")
      .on(table.shopId, table.personId)
      .where(sql`${table.deletedAt} is null`),
    index("customer_gear_items_shop_due_idx")
      .on(table.shopId, table.serviceDueOn)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * One drop-off: what came in, what the customer said was wrong with it, who is
 * working on it, and what was done.
 *
 * **Exactly one owner**, held by a check constraint: a customer's ticket
 * (`person_id`, with the pieces listed in `work_order_items`) or a bench
 * ticket on the shop's own unit (`gear_item_id`). The two read the same on the
 * board and part company in one place only — the care a technician records
 * on a fleet ticket is written to that unit's `gear_service_events`, where on
 * a customer ticket it sets their item's due dates.
 *
 * `number` is the short ticket number a customer quotes over the phone and the
 * claim tag carries — per shop, from 1, never reused.
 *
 * Two prose fields, and which side of the counter each is on is the whole
 * reason there are two: `technician_notes` is staff-only shop talk, and
 * `work_performed` is what the customer is told was done. A single notes field
 * would have one of them leaking.
 */
export const workOrders = pgTable(
  "work_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /** The customer whose gear this is; null on a ticket about the shop's own unit. */
    personId: uuid("person_id").references(() => people.id),
    /** The shop's own unit this ticket is about; null on a customer's ticket. */
    gearItemId: uuid("gear_item_id").references(() => gearItems.id, { onDelete: "cascade" }),
    /** The shop's own ticket number, from 1 — what the claim tag and a phone call use. */
    number: integer("number").notNull(),
    status: workOrderStatus("status").notNull().default("received"),
    /** What the customer said, in their words or the counter's ("free-flows at depth"). */
    reportedProblem: text("reported_problem").notNull(),
    /** The day the shop said it would be ready, in the shop's own calendar. */
    promisedOn: date("promised_on"),
    /** The staff member working it. Assignment, never authorization. */
    technicianPersonId: uuid("technician_person_id").references(() => people.id),
    /** Bench notes. **Staff only** — never rendered on anything a customer reads. */
    technicianNotes: text("technician_notes"),
    /** What was done, written for the customer. */
    workPerformed: text("work_performed"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    /** When it first became ready for pickup; kept if the status moves back. */
    readyAt: timestamp("ready_at", { withTimezone: true }),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    /** How the job ended, once the technician says (the "Work done" record). */
    outcome: workOrderOutcome("outcome"),
    /** Why, in the technician's words: required for unserviceable and condemned. Staff only. */
    outcomeNote: text("outcome_note"),
    outcomeRecordedAt: timestamp("outcome_recorded_at", { withTimezone: true }),
    outcomeRecordedByPersonId: uuid("outcome_recorded_by_person_id").references(() => people.id),
    /**
     * A shop unit's status and service note from before this ticket pulled it
     * off the wall, so deleting the ticket puts back exactly what opening it
     * changed. Null on a customer's ticket.
     */
    unitPriorStatus: gearItemStatus("unit_prior_status"),
    unitPriorServiceNote: text("unit_prior_service_note"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("work_orders_shop_status_idx")
      .on(table.shopId, table.status)
      .where(sql`${table.deletedAt} is null`),
    index("work_orders_shop_person_idx")
      .on(table.shopId, table.personId)
      .where(sql`${table.deletedAt} is null`),
    index("work_orders_shop_gear_item_idx")
      .on(table.shopId, table.gearItemId)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("work_orders_shop_number_unique").on(table.shopId, table.number),
    check(
      "work_orders_one_subject",
      sql`(${table.personId} is not null and ${table.gearItemId} is null) or (${table.personId} is null and ${table.gearItemId} is not null)`,
    ),
  ],
);

/** Which of a customer's pieces one work order covers. */
export const workOrderItems = pgTable(
  "work_order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    customerGearItemId: uuid("customer_gear_item_id")
      .notNull()
      .references(() => customerGearItems.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("work_order_items_unique").on(table.workOrderId, table.customerGearItemId),
    index("work_order_items_item_idx").on(table.customerGearItemId),
    index("work_order_items_shop_idx").on(table.shopId),
  ],
);

/**
 * A part fitted or an hour at the bench, with what it costs. The shop's
 * currency (`shops.currency`) owns the amount, like every other `*_cents`
 * column; nothing here charges anybody — a total on a ticket is a quote the
 * counter reads out, and billing is the orders path.
 *
 * `quantity_hundredths` is a quantity times 100, in whole units: two o-ring
 * kits is `200`, an hour and a half at the bench is `150`. Integer because the
 * line total is integer arithmetic (`workOrderLineTotalCents`) and a float
 * quantity would put a rounding argument between a staffer and the number they
 * read out loud.
 */
export const workOrderLines = pgTable(
  "work_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    kind: workOrderLineKind("kind").notNull(),
    description: text("description").notNull(),
    quantityHundredths: integer("quantity_hundredths").notNull().default(100),
    unitAmountCents: integer("unit_amount_cents").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("work_order_lines_order_idx")
      .on(table.workOrderId, table.createdAt)
      .where(sql`${table.deletedAt} is null`),
    index("work_order_lines_shop_idx").on(table.shopId),
    // A quantity of zero or less is a typo, not a shorter line: it would read
    // as a free part on a total somebody is about to say out loud.
    check("work_order_lines_quantity_positive", sql`${table.quantityHundredths} > 0`),
    // Zero is allowed — a warranty part is a real line at no charge — and a
    // negative one would be a discount, which belongs on the order, not here.
    check("work_order_lines_amount_not_negative", sql`${table.unitAmountCents} >= 0`),
  ],
);

/**
 * The ticket's own history, append-only: who moved it where and when. This is
 * what "who had it and for how long" is read out of, and the reason a status
 * is not just a column somebody overwrites.
 */
export const workOrderEvents = pgTable(
  "work_order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    kind: workOrderEventKind("kind").notNull(),
    /** The status before the move; null on the row that opened the ticket. */
    fromStatus: workOrderStatus("from_status"),
    /** The status after the move; null on a technician hand-over. */
    toStatus: workOrderStatus("to_status"),
    /** Who it was handed to, on a `technician_assigned` row; null means unassigned. */
    technicianPersonId: uuid("technician_person_id").references(() => people.id),
    /**
     * Who acted. Attribution only, and kept: the house pattern for an actor
     * column (`gear_service_events.recorded_by_person_id`) — erasing a staff
     * member anonymizes the `people` row this points at, so the joined name
     * reads as erased while the history keeps its shape.
     */
    actorPersonId: uuid("actor_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * The order these actually happened in, which `created_at` cannot answer:
     * two moves inside one second share an instant (and in a frozen-clock test
     * they always do), and `id` is `defaultRandom()`, so ordering by it is as
     * arbitrary as the heap. The same call `activity_events.seq` makes.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (table) => [
    index("work_order_events_order_idx").on(table.workOrderId, table.seq),
    index("work_order_events_shop_idx").on(table.shopId),
  ],
);

/**
 * **The "Work done" record**: one row per check the technician performed on
 * one piece — which care, whether it passed, the day it was performed, and the
 * next due date they confirmed. The only path from a ticket to a clock.
 *
 * `customer_gear_item_id` names the piece on a customer's ticket and is null
 * on a shop unit's (the ticket names the unit). `kind` borrows the register's
 * own clocks; `note` is "other work, no clock". A failed row is kept as the
 * record of the failure and moves nothing.
 */
export const workOrderCare = pgTable(
  "work_order_care",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    customerGearItemId: uuid("customer_gear_item_id").references(() => customerGearItems.id, {
      onDelete: "cascade",
    }),
    kind: gearServiceKind("kind").notNull(),
    passed: boolean("passed").notNull(),
    performedOn: date("performed_on").notNull(),
    nextDueOn: date("next_due_on"),
    nextDueDives: integer("next_due_dives"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("work_order_care_order_idx").on(table.workOrderId),
    index("work_order_care_shop_idx").on(table.shopId),
    check(
      "work_order_care_due_after_performed",
      sql`${table.nextDueOn} is null or ${table.nextDueOn} > ${table.performedOn}`,
    ),
  ],
);

export type CustomerGearItem = typeof customerGearItems.$inferSelect;

export type WorkOrder = typeof workOrders.$inferSelect;

export type WorkOrderStatusValue = (typeof workOrderStatus.enumValues)[number];

export type WorkOrderItem = typeof workOrderItems.$inferSelect;

export type WorkOrderLine = typeof workOrderLines.$inferSelect;

export type WorkOrderLineKindValue = (typeof workOrderLineKind.enumValues)[number];

export type WorkOrderEvent = typeof workOrderEvents.$inferSelect;

export type WorkOrderCare = typeof workOrderCare.$inferSelect;

export type WorkOrderOutcomeValue = (typeof workOrderOutcome.enumValues)[number];

export type WorkOrderEventKindValue = (typeof workOrderEventKind.enumValues)[number];
