import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { diverTranslator } from "@/i18n/messages";
import { type CalendarDate, calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import {
  type NotificationDelivery,
  type NotificationProvider,
  publicAppUrl,
  recipientLocale,
} from "@/lib/notifications";
import { type CourtesyProvider, sendCourtesyMessage } from "@/lib/notifications/courtesy";
import type { CustomerGearPiece } from "@/lib/notifications/kinds";
import {
  type SmsProvider,
  smsProviderFromEnvironment,
  smsRecipient,
} from "@/lib/notifications/sms";
import { gearServiceDueText, workOrderReadyText } from "@/lib/notifications/work-order-emails";
import type { InvoicingProvider } from "@/lib/payments/invoicing";
import { invoicingProviderFromEnvironment } from "@/lib/payments/invoicing";
import { maySendNow } from "@/lib/send-window";
import {
  customerGearDueDates,
  serviceReminderIsDue,
  type WorkOrderBillStatus,
  workOrderBillAllowsAnother,
  workOrderIsPastPromise,
  workOrderIsUncollected,
} from "@/lib/work-order-follow-up";
import type { WorkOrderStatus } from "@/lib/work-orders";
import { canPersonManageOrders } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { issuePersonCourtesyEmailUnsubscribeToken } from "./courtesy-email";
import { notificationProviderForDb, sendNotification } from "./notifications";
import { type CreateOrderOutcome, createOrder, type NewOrderLineItem, voidOrder } from "./orders";
import { queryAll } from "./query-helpers";
import {
  type CustomerGearNotice,
  type CustomerGearNoticeChannelValue,
  type CustomerGearNoticeStatusValue,
  customerGearItems,
  customerGearNotices,
  customerGearReminderSettings,
  gearItems,
  orders,
  people,
  shops,
  workOrderBills,
  workOrderEvents,
  workOrderItems,
  workOrders,
} from "./schema";
import { stopListedSmsProvider } from "./sms-opt-outs";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";
import { whatsAppProvidersForShops } from "./whatsapp-accounts";

/**
 * What the bench tells a customer and the money it raises (ADR
 * 20261008-work-order-follow-up): the ready-for-pickup message, the bill, the
 * service-due reminder, and the two Today questions about a ticket.
 *
 * Every message goes through the same picker every other diver message does:
 * email when the customer has an address (the tracked channel), otherwise a
 * text over the shop's own WhatsApp or platform SMS
 * (`src/lib/notifications/courtesy.ts`). One message per event, never both.
 */

export type FollowUpProviders = {
  emailProvider?: NotificationProvider;
  smsProvider?: SmsProvider;
  /** Per-shop WhatsApp senders, keyed by shop id; defaults to whatever the shops have connected. */
  whatsAppProviders?: Map<string, CourtesyProvider>;
};

type Delivered = {
  status: Extract<CustomerGearNoticeStatusValue, "sent" | "failed" | "not_configured">;
  channel: CustomerGearNoticeChannelValue;
};

function noticeStatusOf(
  delivery: NotificationDelivery | { status: "sent" | "failed" | "not_configured" },
): Delivered["status"] {
  return delivery.status;
}

async function settleNotice(
  db: DbExecutor,
  noticeId: string,
  outcome: {
    status: CustomerGearNoticeStatusValue;
    channel: CustomerGearNoticeChannelValue | null;
  },
) {
  await db
    .update(customerGearNotices)
    .set({ status: outcome.status, channel: outcome.channel, updatedAt: nowDate() })
    .where(eq(customerGearNotices.id, noticeId));
}

/** The pieces a ticket covers, as a message names them. */
async function piecesOnTicket(db: DbExecutor, workOrderId: string): Promise<CustomerGearPiece[]> {
  const rows = await db
    .select({ kind: customerGearItems.kind, brandModel: customerGearItems.brandModel })
    .from(workOrderItems)
    .innerJoin(customerGearItems, eq(customerGearItems.id, workOrderItems.customerGearItemId))
    .where(eq(workOrderItems.workOrderId, workOrderId))
    .orderBy(asc(workOrderItems.createdAt));
  return rows.map((row) => ({
    kind: row.kind,
    ...(row.brandModel?.trim() ? { brandModel: row.brandModel.trim().slice(0, 120) } : {}),
  }));
}

export type ReadyNoticeOutcome =
  | {
      ok: true;
      status: CustomerGearNoticeStatusValue;
      channel: CustomerGearNoticeChannelValue | null;
    }
  | {
      ok: false;
      /**
       * - `not_found` — no live ticket by that id in this shop.
       * - `not_customer` — a ticket on the shop's own unit; nobody to tell.
       * - `not_ready` — the ticket is not on ready.
       * - `already` — this move to ready was already announced.
       */
      reason: "not_found" | "not_customer" | "not_ready" | "already";
    };

/**
 * Tell the customer their gear is ready to collect.
 *
 * **Automatic** (no `resendByPersonId`): announces the ticket's latest move to
 * ready, at most once — the notice row is claimed on that move's event id,
 * which is unique, before any provider is called. A ticket that goes back on
 * the bench and comes ready again is a new move and a new message.
 *
 * **Resend** (`resendByPersonId` set): a staffer asked for it, so it is sent
 * whatever went before, and recorded under their name.
 *
 * Nothing for a ticket on the shop's own unit, and nothing unless the ticket
 * is ready now: a Resend pressed on a stale tab after the gear was collected
 * must not tell the customer to come and get it.
 */
export async function sendWorkOrderReadyNotice(
  db: AppDb,
  input: { shopId: string; workOrderId: string; resendByPersonId?: string },
  providers: FollowUpProviders = {},
): Promise<ReadyNoticeOutcome> {
  const [row] = await db
    .select({ workOrder: workOrders, person: people, shop: shops })
    .from(workOrders)
    .innerJoin(shops, eq(shops.id, workOrders.shopId))
    .leftJoin(people, eq(people.id, workOrders.personId))
    .where(
      and(
        eq(workOrders.id, input.workOrderId),
        eq(workOrders.shopId, input.shopId),
        isNull(workOrders.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  const { workOrder, person, shop } = row;
  if (!workOrder.personId || !person) return { ok: false, reason: "not_customer" };
  if (workOrder.status !== "ready") return { ok: false, reason: "not_ready" };

  let eventId: string | null = null;
  if (!input.resendByPersonId) {
    const [event] = await db
      .select({ id: workOrderEvents.id })
      .from(workOrderEvents)
      .where(
        and(eq(workOrderEvents.workOrderId, workOrder.id), eq(workOrderEvents.toStatus, "ready")),
      )
      .orderBy(desc(workOrderEvents.seq))
      .limit(1);
    // A ticket can only reach ready through a recorded move, so a missing
    // event is a row written some other way; there is no move to announce.
    if (!event) return { ok: false, reason: "already" };
    eventId = event.id;
  }

  const [claimed] = await db
    .insert(customerGearNotices)
    .values({
      shopId: shop.id,
      kind: "ready_for_pickup",
      personId: person.id,
      workOrderId: workOrder.id,
      workOrderEventId: eventId,
      sentByPersonId: input.resendByPersonId ?? null,
      createdAt: nowDate(),
      updatedAt: nowDate(),
    })
    .onConflictDoNothing()
    .returning({ id: customerGearNotices.id });
  if (!claimed) return { ok: false, reason: "already" };

  const pieces = await piecesOnTicket(db, workOrder.id);
  const locale = recipientLocale(person.locale, shop.defaultLocale);
  const workPerformed = workOrder.workPerformed?.trim() || undefined;
  const phone = smsRecipient(person.phone);

  // A removed or erased record is somebody the shop can no longer write to.
  if (person.deletedAt) {
    await settleNotice(db, claimed.id, { status: "no_contact", channel: null });
    return { ok: true, status: "no_contact", channel: null };
  }

  if (person.email) {
    const delivery = await sendNotification(
      db,
      {
        kind: "work_order_ready",
        noticeId: claimed.id,
        workOrderId: workOrder.id,
        shopId: shop.id,
        to: person.email,
        locale,
        diverName: person.fullName,
        shopName: shop.name,
        pieces,
        ...(workPerformed ? { workPerformed: workPerformed.slice(0, 4000) } : {}),
      },
      notificationProviderForDb(providers.emailProvider),
    );
    const status = noticeStatusOf(delivery);
    await settleNotice(db, claimed.id, { status, channel: "email" });
    return { ok: true, status, channel: "email" };
  }

  if (phone) {
    const t = diverTranslator(locale);
    const senders = providers.whatsAppProviders ?? (await whatsAppProvidersForShops(db, [shop.id]));
    const whatsapp = senders.get(shop.id) ?? null;
    const { channel, delivery } = await sendCourtesyMessage(
      {
        to: phone,
        body: workOrderReadyText(t, locale, { shopName: shop.name, pieces, workPerformed }),
        smsStopLine: t("notifications.sms.stopLine"),
        shopName: shop.name,
      },
      {
        sms: stopListedSmsProvider(db, providers.smsProvider ?? smsProviderFromEnvironment()),
        whatsapp,
      },
    );
    const status = noticeStatusOf(delivery);
    await settleNotice(db, claimed.id, { status, channel });
    return { ok: true, status, channel };
  }

  await settleNotice(db, claimed.id, { status: "no_contact", channel: null });
  return { ok: true, status: "no_contact", channel: null };
}

/** The newest ready message on a ticket, for the ticket's own card. */
export async function latestReadyNotice(
  db: DbExecutor,
  shopId: string,
  workOrderId: string,
): Promise<CustomerGearNotice | null> {
  const [notice] = await db
    .select()
    .from(customerGearNotices)
    .where(
      and(
        eq(customerGearNotices.shopId, shopId),
        eq(customerGearNotices.workOrderId, workOrderId),
        eq(customerGearNotices.kind, "ready_for_pickup"),
      ),
    )
    .orderBy(desc(customerGearNotices.seq))
    .limit(1);
  return notice ?? null;
}

export type WorkOrderBillSummary = {
  orderId: string;
  status: WorkOrderBillStatus;
  totalCents: number;
  amountPaidCents: number;
  currency: string;
  hostedInvoiceUrl: string | null;
  sentAt: Date;
};

/** The ticket's bill: the newest order raised from it, with that order's own status. */
export async function getWorkOrderBill(
  db: DbExecutor,
  shopId: string,
  workOrderId: string,
): Promise<WorkOrderBillSummary | null> {
  const [row] = await db
    .select({
      orderId: orders.id,
      status: orders.status,
      totalCents: orders.totalCents,
      amountPaidCents: orders.amountPaidCents,
      currency: orders.currency,
      hostedInvoiceUrl: orders.hostedInvoiceUrl,
      sentAt: workOrderBills.createdAt,
    })
    .from(workOrderBills)
    .innerJoin(orders, and(eq(orders.id, workOrderBills.orderId), eq(orders.shopId, shopId)))
    .where(and(eq(workOrderBills.shopId, shopId), eq(workOrderBills.workOrderId, workOrderId)))
    .orderBy(desc(workOrderBills.seq))
    .limit(1);
  return row ?? null;
}

export type BillWorkOrderOutcome =
  | { ok: true; orderId: string }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_customer"
        | "no_lines"
        | "already_billed"
        | Extract<CreateOrderOutcome, { ok: false }>["reason"];
    };

/**
 * **Send the bill**: one Stripe order built from the ticket's parts and labor,
 * through `createOrder` — never a parallel billing path (owner decision
 * 2026-10-08, ADR 20260719-stripe-connect-orders). `createOrder` keeps every
 * rule it has: owner or manager only, the shop's currency, its line limits, a
 * connected account, a customer with an address.
 *
 * The lines arrive composed (`billLinesForWorkOrder` plus the caller's words,
 * since this layer writes no sentences) and are refused when empty.
 *
 * **One open bill per ticket.** Refused up front while the newest bill is open
 * or settled; and because the Stripe call cannot sit inside a transaction, the
 * link is written under a row lock that checks again — two staffers pressing
 * Send at once leave one bill, and the loser's invoice is voided at Stripe
 * before anybody is asked to pay it.
 */
export async function billWorkOrder(
  db: AppDb,
  input: {
    shopId: string;
    workOrderId: string;
    actorPersonId: string;
    description: string;
    lineItems: NewOrderLineItem[];
  },
  invoicing: InvoicingProvider = invoicingProviderFromEnvironment(),
): Promise<BillWorkOrderOutcome> {
  const [workOrder] = await db
    .select({ id: workOrders.id, personId: workOrders.personId })
    .from(workOrders)
    .where(
      and(
        eq(workOrders.id, input.workOrderId),
        eq(workOrders.shopId, input.shopId),
        isNull(workOrders.deletedAt),
      ),
    )
    .limit(1);
  if (!workOrder) return { ok: false, reason: "not_found" };
  if (!workOrder.personId) return { ok: false, reason: "not_customer" };
  if (input.lineItems.length === 0) return { ok: false, reason: "no_lines" };

  const before = await getWorkOrderBill(db, input.shopId, workOrder.id);
  if (!workOrderBillAllowsAnother(before?.status ?? null)) {
    return { ok: false, reason: "already_billed" };
  }

  const created = await createOrder(
    db,
    {
      shopId: input.shopId,
      personId: workOrder.personId,
      createdByPersonId: input.actorPersonId,
      description: input.description,
      lineItems: input.lineItems,
    },
    invoicing,
  );
  if (!created.ok) return created;

  const linked = await db.transaction(async (tx) => {
    await tx
      .select({ id: workOrders.id })
      .from(workOrders)
      .where(eq(workOrders.id, workOrder.id))
      .for("update");
    const current = await getWorkOrderBill(tx, input.shopId, workOrder.id);
    if (current && current.orderId !== before?.orderId) return false;
    await tx.insert(workOrderBills).values({
      shopId: input.shopId,
      workOrderId: workOrder.id,
      orderId: created.order.id,
      createdByPersonId: input.actorPersonId,
      createdAt: nowDate(),
    });
    return true;
  });
  if (!linked) {
    await voidOrder(db, input.shopId, created.order.id, invoicing);
    return { ok: false, reason: "already_billed" };
  }
  return { ok: true, orderId: created.order.id };
}

/** Which of these pieces have their service reminders turned off. */
export async function piecesWithRemindersOff(
  db: DbExecutor,
  shopId: string,
  customerGearItemIds: readonly string[],
): Promise<Set<string>> {
  if (customerGearItemIds.length === 0) return new Set();
  const rows = await db
    .select({ id: customerGearReminderSettings.customerGearItemId })
    .from(customerGearReminderSettings)
    .where(
      and(
        eq(customerGearReminderSettings.shopId, shopId),
        inArray(customerGearReminderSettings.customerGearItemId, [...customerGearItemIds]),
        isNotNull(customerGearReminderSettings.remindersOffAt),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

export type SetRemindersOutcome = { ok: true } | { ok: false; reason: "not_found" };

/** Turn a piece's service reminders off or back on. */
export async function setCustomerGearReminders(
  db: AppDb,
  input: { shopId: string; customerGearItemId: string; on: boolean; actorPersonId?: string },
): Promise<SetRemindersOutcome> {
  const [piece] = await db
    .select({ id: customerGearItems.id })
    .from(customerGearItems)
    .where(
      and(
        eq(customerGearItems.id, input.customerGearItemId),
        eq(customerGearItems.shopId, input.shopId),
        isNull(customerGearItems.deletedAt),
      ),
    )
    .limit(1);
  if (!piece) return { ok: false, reason: "not_found" };
  const now = nowDate();
  const values = {
    remindersOffAt: input.on ? null : now,
    changedByPersonId: input.actorPersonId ?? null,
    updatedAt: now,
  };
  await db
    .insert(customerGearReminderSettings)
    .values({ shopId: input.shopId, customerGearItemId: piece.id, createdAt: now, ...values })
    .onConflictDoUpdate({ target: customerGearReminderSettings.customerGearItemId, set: values });
  return { ok: true };
}

/** When each of these pieces was last reminded about, newest first per piece. */
export async function lastServiceReminders(
  db: DbExecutor,
  shopId: string,
  customerGearItemIds: readonly string[],
): Promise<Map<string, { dueOn: string; status: CustomerGearNoticeStatusValue; at: Date }>> {
  if (customerGearItemIds.length === 0) return new Map();
  const rows = await db
    .select({
      itemId: customerGearNotices.customerGearItemId,
      dueOn: customerGearNotices.dueOn,
      status: customerGearNotices.status,
      at: customerGearNotices.createdAt,
    })
    .from(customerGearNotices)
    .where(
      and(
        eq(customerGearNotices.shopId, shopId),
        eq(customerGearNotices.kind, "service_due"),
        inArray(customerGearNotices.customerGearItemId, [...customerGearItemIds]),
      ),
    )
    .orderBy(desc(customerGearNotices.seq));
  const out = new Map<string, { dueOn: string; status: CustomerGearNoticeStatusValue; at: Date }>();
  for (const row of rows) {
    if (!row.itemId || !row.dueOn || out.has(row.itemId)) continue;
    out.set(row.itemId, { dueOn: row.dueOn, status: row.status, at: row.at });
  }
  return out;
}

/** What the reminder pass knows about one of a diver's pieces. */
export type ServiceReminderState = {
  off: boolean;
  /** When the last service reminder for this piece actually went, if one did. */
  lastSentAt: Date | null;
};

/** The diver record's read: each piece's switch and its last reminder sent. */
export async function serviceReminderStates(
  db: DbExecutor,
  shopId: string,
  customerGearItemIds: readonly string[],
): Promise<Map<string, ServiceReminderState>> {
  const [off, last] = await queryAll(db, [
    () => piecesWithRemindersOff(db, shopId, customerGearItemIds),
    () => lastServiceReminders(db, shopId, customerGearItemIds),
  ]);
  return new Map(
    customerGearItemIds.map((id) => {
      const reminder = last.get(id);
      return [
        id,
        { off: off.has(id), lastSentAt: reminder?.status === "sent" ? reminder.at : null },
      ];
    }),
  );
}

export type ServiceReminderRunSummary = {
  /** Live customer pieces with a due date inside the window, before any rule. */
  scanned: number;
  sent: number;
  /** Due, and waiting for the shop's own daytime (`src/lib/send-window.ts`). */
  held: number;
  /** Already reminded about this date, reminders off, or on the bench right now. */
  skipped: number;
  /** Turned optional email off and left no phone to text. */
  optedOut: number;
  /** No email and no textable phone on the record. */
  noContact: number;
  failed: number;
};

export type SendServiceRemindersOptions = FollowUpProviders & {
  now?: Date;
  /** Origin for the unsubscribe link; defaults to the configured public app URL. */
  appOrigin?: string | null;
};

/**
 * **Service-due reminders**: every customer piece with a date coming up in
 * the next month gets one message about it, through the channel picker,
 * across every shop (owner decision 2026-10-08).
 *
 * Once per piece per clock per date, held by the database: the notice row is
 * claimed on that triple, which is unique, before any provider is called, so a
 * rerun, an overlapping pass or a crash between claim and send cannot repeat
 * one. A new date (the work was done and the clock moved) is a new reminder.
 *
 * Skipped, with nothing written so a later fix still gets a reminder through:
 * a piece whose reminders are off, a deleted piece or person, a piece that is
 * on an open ticket right now (the shop is holding it), a person who turned
 * optional email off and has no phone, and a person with no way to reach
 * them. Only customers' own gear: the shop's fleet runs its clocks on the
 * register and Today, never by message.
 *
 * Sent only inside the shop's own daytime, so this rides the hourly pass and
 * a held reminder goes out on the shop's next morning.
 */
export async function sendDueServiceReminders(
  db: AppDb,
  options: SendServiceRemindersOptions = {},
): Promise<ServiceReminderRunSummary> {
  const now = options.now ?? nowDate();
  const origin = options.appOrigin === undefined ? publicAppUrl() : options.appOrigin;
  const summary: ServiceReminderRunSummary = {
    scanned: 0,
    sent: 0,
    held: 0,
    skipped: 0,
    optedOut: 0,
    noContact: 0,
    failed: 0,
  };

  // A day either side of the UTC calendar covers every shop's own today; the
  // exact window is decided per shop below, on that shop's calendar.
  const utcToday = calendarDateInTimezone(now, "UTC");
  const rows = await db
    .select({ piece: customerGearItems, person: people, shop: shops })
    .from(customerGearItems)
    .innerJoin(people, eq(people.id, customerGearItems.personId))
    .innerJoin(shops, eq(shops.id, customerGearItems.shopId))
    .leftJoin(
      customerGearReminderSettings,
      eq(customerGearReminderSettings.customerGearItemId, customerGearItems.id),
    )
    .where(
      and(
        isNull(customerGearItems.deletedAt),
        isNull(people.deletedAt),
        isNull(customerGearReminderSettings.remindersOffAt),
        isNotNull(customerGearItems.serviceDueOn),
        gte(customerGearItems.serviceDueOn, shiftCalendarDate(utcToday, -1)),
        lte(customerGearItems.serviceDueOn, shiftCalendarDate(utcToday, 32)),
      ),
    );
  if (rows.length === 0) return summary;

  // Pieces the shop is holding right now: a reminder to bring in a regulator
  // that is on the bench reads as the shop having lost track of it.
  const onBench = new Set(
    (
      await db
        .select({ id: workOrderItems.customerGearItemId })
        .from(workOrderItems)
        .innerJoin(workOrders, eq(workOrders.id, workOrderItems.workOrderId))
        .where(
          and(
            inArray(
              workOrderItems.customerGearItemId,
              rows.map((row) => row.piece.id),
            ),
            isNull(workOrders.deletedAt),
            ne(workOrders.status, "picked_up"),
          ),
        )
    ).map((row) => row.id),
  );

  const smsProvider = stopListedSmsProvider(
    db,
    options.smsProvider ?? smsProviderFromEnvironment(),
  );
  const emailProvider = notificationProviderForDb(options.emailProvider);
  let whatsAppProviders = options.whatsAppProviders;

  for (const { piece, person, shop } of rows) {
    const todayLocal = calendarDateInTimezone(now, shop.timezone);
    const due = customerGearDueDates(piece).filter((date) =>
      serviceReminderIsDue(date.dueOn, todayLocal),
    );
    if (due.length === 0) continue;
    summary.scanned += due.length;
    if (onBench.has(piece.id)) {
      summary.skipped += due.length;
      continue;
    }
    if (!maySendNow("gear_service_due", now, shop.timezone)) {
      summary.held += due.length;
      continue;
    }

    const phone = smsRecipient(person.phone);
    const emailOk = Boolean(person.email && !person.courtesyEmailOptOutAt && origin);
    if (!emailOk && !phone) {
      if (person.email && person.courtesyEmailOptOutAt) summary.optedOut += due.length;
      else summary.noContact += due.length;
      continue;
    }

    const locale = recipientLocale(person.locale, shop.defaultLocale);
    const t = diverTranslator(locale);
    const named: CustomerGearPiece = {
      kind: piece.kind,
      ...(piece.brandModel?.trim() ? { brandModel: piece.brandModel.trim().slice(0, 120) } : {}),
    };

    for (const date of due) {
      const [claimed] = await db
        .insert(customerGearNotices)
        .values({
          shopId: shop.id,
          kind: "service_due",
          personId: person.id,
          customerGearItemId: piece.id,
          dueClock: date.clock,
          dueOn: date.dueOn,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: customerGearNotices.id });
      if (!claimed) {
        summary.skipped += 1;
        continue;
      }

      let outcome: Delivered;
      if (emailOk && person.email && origin) {
        const token = await issuePersonCourtesyEmailUnsubscribeToken(db, {
          shopId: shop.id,
          personId: person.id,
        });
        const delivery = await sendNotification(
          db,
          {
            kind: "gear_service_due",
            noticeId: claimed.id,
            shopId: shop.id,
            to: person.email,
            locale,
            diverName: person.fullName,
            shopName: shop.name,
            piece: named,
            clock: date.clock,
            dueOn: date.dueOn,
            unsubscribeUrl: new URL(`/unsubscribe/${token}`, `${origin}/`).toString(),
          },
          emailProvider,
        );
        outcome = { status: noticeStatusOf(delivery), channel: "email" };
      } else {
        whatsAppProviders ??= await whatsAppProvidersForShops(
          db,
          rows.map((row) => row.shop.id),
        );
        const { channel, delivery } = await sendCourtesyMessage(
          {
            to: phone as string,
            body: gearServiceDueText(t, locale, {
              shopName: shop.name,
              piece: named,
              clock: date.clock,
              dueOn: date.dueOn,
            }),
            smsStopLine: t("notifications.sms.stopLine"),
            shopName: shop.name,
          },
          { sms: smsProvider, whatsapp: whatsAppProviders.get(shop.id) ?? null },
        );
        outcome = { status: noticeStatusOf(delivery), channel };
      }
      await settleNotice(db, claimed.id, outcome);
      if (outcome.status === "sent") summary.sent += 1;
      else summary.failed += 1;
    }
  }
  return summary;
}

export type WorkOrderAttentionRow = {
  workOrderId: string;
  reason: "past_promise" | "uncollected";
  status: WorkOrderStatus;
  /** The customer's name, or the shop unit's label on a bench ticket. */
  subject: string;
  /** The promised day (past promise) or the day it went ready (uncollected). */
  since: CalendarDate;
};

/**
 * The two questions Today asks about the bench: tickets still being worked
 * after the day the shop promised them, and tickets ready for a week or more
 * that nobody has collected. Both read the shop's own calendar.
 */
export async function listWorkOrdersNeedingAttention(
  db: DbExecutor,
  shopId: string,
  input: { todayLocal: CalendarDate; timezone: string },
): Promise<WorkOrderAttentionRow[]> {
  const rows = await db
    .select({
      id: workOrders.id,
      status: workOrders.status,
      promisedOn: workOrders.promisedOn,
      readyAt: workOrders.readyAt,
      personId: workOrders.personId,
      personName: people.fullName,
      unitLabel: gearItems.label,
    })
    .from(workOrders)
    .leftJoin(people, eq(people.id, workOrders.personId))
    .leftJoin(gearItems, eq(gearItems.id, workOrders.gearItemId))
    .where(
      and(
        eq(workOrders.shopId, shopId),
        isNull(workOrders.deletedAt),
        ne(workOrders.status, "picked_up"),
        sql`(${workOrders.promisedOn} < ${input.todayLocal} or ${workOrders.status} = 'ready')`,
      ),
    )
    .orderBy(asc(workOrders.promisedOn), asc(workOrders.receivedAt));

  const out: WorkOrderAttentionRow[] = [];
  for (const row of rows) {
    const subject = row.personName ?? row.unitLabel ?? "";
    if (workOrderIsPastPromise({ ...row, todayLocal: input.todayLocal }) && row.promisedOn) {
      out.push({
        workOrderId: row.id,
        reason: "past_promise",
        status: row.status,
        subject,
        since: row.promisedOn as CalendarDate,
      });
      continue;
    }
    const readyOn = row.readyAt ? calendarDateInTimezone(row.readyAt, input.timezone) : null;
    // Only a customer collects: a shop unit that is done goes back on the wall.
    if (
      row.personId &&
      workOrderIsUncollected({ status: row.status, readyOn, todayLocal: input.todayLocal })
    ) {
      out.push({
        workOrderId: row.id,
        reason: "uncollected",
        status: row.status,
        subject,
        since: readyOn as CalendarDate,
      });
    }
  }
  return out;
}

export type BillAndPickupFacts = {
  readyNotice: CustomerGearNotice | null;
  bill: WorkOrderBillSummary | null;
  /** The shop can take a Stripe payment right now. */
  connected: boolean;
  /** The viewer may raise an order (owner or manager, re-read from roles). */
  canBill: boolean;
  /** The customer has an address a Stripe invoice can go to. */
  customerHasEmail: boolean;
};

/** Everything a ticket's bill-and-pickup card shows, in one read. */
export async function billAndPickupFacts(
  db: DbExecutor,
  input: { shopId: string; workOrderId: string; personId: string; viewerPersonId: string },
): Promise<BillAndPickupFacts> {
  const [readyNotice, bill, account, canBill, [customer]] = await queryAll(db, [
    () => latestReadyNotice(db, input.shopId, input.workOrderId),
    () => getWorkOrderBill(db, input.shopId, input.workOrderId),
    () => getShopStripeAccount(db, input.shopId),
    () => canPersonManageOrders(db, input.shopId, input.viewerPersonId),
    () =>
      db
        .select({ email: people.email })
        .from(people)
        .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
        .limit(1),
  ]);
  return {
    readyNotice,
    bill,
    connected: canAcceptPayments(account),
    canBill,
    customerHasEmail: Boolean(customer?.email),
  };
}
