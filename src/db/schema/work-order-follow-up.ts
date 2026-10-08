import { sql } from "drizzle-orm";
import {
  bigserial,
  date,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { people, shops } from "./core";
import { gearServiceKind } from "./gear";
import { orders } from "./payments";
import { customerGearItems, workOrderEvents, workOrders } from "./work-orders";

/**
 * What the bench says to the customer, and the money it raises
 * (ADR 20261008-work-order-follow-up, the second half of
 * 20261008-gear-work-orders).
 *
 * Three tables, all new and none widening the bench's own: a ticket is still
 * not money, and a customer's piece still carries only its due dates. What
 * these add is the record of each message the shop sent about a customer's
 * gear, the link from a ticket to the order that billed it, and a piece's
 * reminder switch.
 */

/** Which message a notice row records. */
export const customerGearNoticeKind = pgEnum("customer_gear_notice_kind", [
  /** "Your gear is ready", sent when a customer's ticket moves to ready. */
  "ready_for_pickup",
  /** "Your regulator is due for service", sent about a month before a due date. */
  "service_due",
]);

/**
 * How that message went. `sending` is the claim a sender writes *before* it
 * calls a provider, so a second pass or a double-clicked button finds the row
 * and sends nothing; a crash between claim and send leaves `sending`, which
 * reads on the ticket as "not sent" and can be resent by hand.
 */
export const customerGearNoticeStatus = pgEnum("customer_gear_notice_status", [
  "sending",
  "sent",
  "failed",
  "not_configured",
  /** No email and no textable phone on the diver's record. */
  "no_contact",
  /** The diver turned off optional email and left no phone to text instead. */
  "opted_out",
]);

/** Which channel carried a sent notice. */
export const customerGearNoticeChannel = pgEnum("customer_gear_notice_channel", [
  "email",
  "sms",
  "whatsapp",
]);

/**
 * One message to a customer about their gear: a ready-for-pickup notice on a
 * ticket, or a service-due reminder on a piece.
 *
 * **Once is held by the database, not by a read-then-send.** A ready notice
 * sent on its own carries the `work_order_events` row of the move to ready, and
 * that column is unique: one move to ready, one message, however many times
 * the action runs. A staffer's resend carries no event and is not limited. A
 * reminder carries its piece, which clock and the due date, and that triple is
 * unique: one reminder per due date, and a new date is a new reminder.
 *
 * Never the message itself: the words were composed at send time from the
 * bundle and live in the recipient's inbox. Nothing here is personal beyond
 * whose gear it was.
 */
export const customerGearNotices = pgTable(
  "customer_gear_notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    kind: customerGearNoticeKind("kind").notNull(),
    /** The customer it went to. */
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    /** On a ready notice: the ticket. */
    workOrderId: uuid("work_order_id").references(() => workOrders.id, { onDelete: "cascade" }),
    /** On an automatic ready notice: the move to ready it announced. Null on a resend. */
    workOrderEventId: uuid("work_order_event_id").references(() => workOrderEvents.id, {
      onDelete: "cascade",
    }),
    /** On a reminder: the piece. */
    customerGearItemId: uuid("customer_gear_item_id").references(() => customerGearItems.id, {
      onDelete: "cascade",
    }),
    /** On a reminder: which of the piece's clocks came due. */
    dueClock: gearServiceKind("due_clock"),
    /** On a reminder: the due date it was about. */
    dueOn: date("due_on"),
    status: customerGearNoticeStatus("status").notNull().default("sending"),
    channel: customerGearNoticeChannel("channel"),
    /** The staffer who pressed Resend; null on a notice the app sent on its own. */
    sentByPersonId: uuid("sent_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * The order these were written in, which `created_at` cannot answer for
     * two sends inside one instant (a Resend pressed straight after the
     * automatic message) — the same call `work_order_events.seq` makes.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("customer_gear_notices_ready_once").on(table.workOrderEventId),
    uniqueIndex("customer_gear_notices_reminder_once").on(
      table.customerGearItemId,
      table.dueClock,
      table.dueOn,
    ),
    index("customer_gear_notices_order_idx").on(table.workOrderId, table.seq),
    index("customer_gear_notices_item_idx").on(table.customerGearItemId, table.seq),
    index("customer_gear_notices_shop_idx").on(table.shopId),
    index("customer_gear_notices_person_idx").on(table.personId),
  ],
);

/**
 * The order that billed a ticket (owner decision 2026-10-08: billing goes
 * through Stripe orders, never a parallel path). A row per bill, because a
 * voided bill can be followed by a second one; the newest row is the ticket's
 * bill, and `order_id` is unique so one order never bills two tickets.
 */
export const workOrderBills = pgTable(
  "work_order_bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    createdByPersonId: uuid("created_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("work_order_bills_order_unique").on(table.orderId),
    index("work_order_bills_work_order_idx").on(table.workOrderId, table.createdAt),
    index("work_order_bills_shop_idx").on(table.shopId),
  ],
);

/**
 * A piece's service reminders switch. No row means on (owner decision
 * 2026-10-08: reminders send automatically, with an opt-out per piece);
 * `reminders_off_at` set means the customer asked not to hear about this one.
 * Turning them back on clears the stamp rather than deleting the row.
 */
export const customerGearReminderSettings = pgTable(
  "customer_gear_reminder_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    customerGearItemId: uuid("customer_gear_item_id")
      .notNull()
      .references(() => customerGearItems.id, { onDelete: "cascade" }),
    remindersOffAt: timestamp("reminders_off_at", { withTimezone: true }),
    changedByPersonId: uuid("changed_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("customer_gear_reminder_settings_item_unique").on(table.customerGearItemId),
    index("customer_gear_reminder_settings_shop_off_idx")
      .on(table.shopId)
      .where(sql`${table.remindersOffAt} is not null`),
  ],
);

export type CustomerGearNotice = typeof customerGearNotices.$inferSelect;

export type CustomerGearNoticeStatusValue = (typeof customerGearNoticeStatus.enumValues)[number];

export type CustomerGearNoticeChannelValue = (typeof customerGearNoticeChannel.enumValues)[number];

export type WorkOrderBill = typeof workOrderBills.$inferSelect;
