import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import type { Notification } from "@/lib/notifications";
import type {
  CreateInvoiceRequest,
  CreateInvoiceResult,
  InvoicingProvider,
} from "@/lib/payments/invoicing";
import { seededShopContext } from "@/test/db";
import { fakeCourtesy, fakeEmail, fakeSms } from "@/test/fakes";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
} from "@/test/staff-session";
import type { AppDb } from "./client";
import { createDiver } from "./divers";
import { createGearItem } from "./gear";
import { markOrderVoidedByInvoiceId } from "./orders";
import { customerGearItems, customerGearNotices, people, shops } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import {
  billWorkOrder,
  getWorkOrderBill,
  lastServiceReminders,
  latestReadyNotice,
  listWorkOrdersNeedingAttention,
  piecesWithRemindersOff,
  sendDueServiceReminders,
  sendWorkOrderReadyNotice,
  setCustomerGearReminders,
} from "./work-order-follow-up";
import {
  addCustomerGearItem,
  createWorkOrder,
  deleteCustomerGearItem,
  saveWorkOrderNotes,
  setWorkOrderStatus,
} from "./work-orders";

// The suite's frozen clock is 2026-07-21T13:30Z: 09:30 in New York, inside
// every shop's daytime window, and "today" on the shop's own calendar.
const TODAY = "2026-07-21";

async function context() {
  const { db, shop: demo } = await seededShopContext();
  const [shop] = await db
    .insert(shops)
    .values({ name: "Bench Divers", slug: "bench-follow-up", timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  return { db, shop, demo };
}

async function diver(
  db: AppDb,
  shopId: string,
  fullName: string,
  contact: { email?: string | null; phone?: string | null } = {},
) {
  const person = await createDiver(db, {
    shopId,
    fullName,
    email:
      contact.email === undefined
        ? `${fullName.toLowerCase().replace(/[^a-z]+/g, "-")}@example.com`
        : (contact.email ?? undefined),
    phone: contact.phone ?? undefined,
  });
  if (!person) throw new Error("diver insert failed");
  return person;
}

async function piece(
  db: AppDb,
  shopId: string,
  personId: string,
  input: { kind?: "regulator" | "tank" | "bcd"; serviceDueOn?: string } = {},
) {
  const outcome = await addCustomerGearItem(db, {
    shopId,
    personId,
    kind: input.kind ?? "regulator",
    brandModel: "Apeks XTX200",
    serviceDueOn: input.serviceDueOn ?? "",
  });
  if (!outcome.ok) throw new Error(`piece refused: ${outcome.reason}`);
  return outcome.item;
}

async function readyTicket(db: AppDb, shopId: string, personId: string, pieceId: string) {
  const outcome = await createWorkOrder(db, {
    shopId,
    personId,
    customerGearItemIds: [pieceId],
    reportedProblem: "Free-flows at depth",
  });
  if (!outcome.ok) throw new Error(`ticket refused: ${outcome.reason}`);
  // What the customer is told was done: the words the message carries.
  await saveWorkOrderNotes(db, {
    shopId,
    workOrderId: outcome.workOrder.id,
    workPerformed: "Serviced both stages and replaced the HP seat.",
  });
  const moved = await setWorkOrderStatus(db, {
    shopId,
    workOrderId: outcome.workOrder.id,
    status: "ready",
    todayLocal: TODAY,
  });
  if (!moved.ok) throw new Error(`move refused: ${moved.reason}`);
  return outcome.workOrder;
}

function onlyTo(sent: Notification[], to: string) {
  return sent.filter((notification) => "to" in notification && notification.to === to);
}

describe("the ready-for-pickup message", () => {
  it("emails the customer once for one move to ready, naming the shop, the gear and the work", async () => {
    const { db, shop } = await context();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const reg = await piece(db, shop.id, maya.id);
    const ticket = await readyTicket(db, shop.id, maya.id, reg.id);
    const email = fakeEmail();

    const first = await sendWorkOrderReadyNotice(
      db,
      { shopId: shop.id, workOrderId: ticket.id },
      { emailProvider: email.provider },
    );
    const second = await sendWorkOrderReadyNotice(
      db,
      { shopId: shop.id, workOrderId: ticket.id },
      { emailProvider: email.provider },
    );

    expect(first).toEqual({ ok: true, status: "sent", channel: "email" });
    expect(second).toEqual({ ok: false, reason: "already" });
    expect(email.sent).toHaveLength(1);
    const [sent] = email.sent;
    expect(sent?.kind).toBe("work_order_ready");
    if (sent?.kind !== "work_order_ready") return;
    expect(sent.shopName).toBe("Bench Divers");
    expect(sent.pieces).toEqual([{ kind: "regulator", brandModel: "Apeks XTX200" }]);
    expect(sent.workPerformed).toBe("Serviced both stages and replaced the HP seat.");
    expect((await latestReadyNotice(db, shop.id, ticket.id))?.status).toBe("sent");
  });

  it("sends again when a ticket goes back on the bench and comes ready a second time", async () => {
    const { db, shop } = await context();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const reg = await piece(db, shop.id, maya.id);
    const ticket = await readyTicket(db, shop.id, maya.id, reg.id);
    const email = fakeEmail();
    await sendWorkOrderReadyNotice(
      db,
      { shopId: shop.id, workOrderId: ticket.id },
      { emailProvider: email.provider },
    );
    for (const status of ["in_progress", "ready"] as const) {
      await setWorkOrderStatus(db, {
        shopId: shop.id,
        workOrderId: ticket.id,
        status,
        todayLocal: TODAY,
      });
    }

    const again = await sendWorkOrderReadyNotice(
      db,
      { shopId: shop.id, workOrderId: ticket.id },
      { emailProvider: email.provider },
    );
    expect(again.ok).toBe(true);
    expect(email.sent).toHaveLength(2);
  });

  it("resends on a staffer's word, under their name", async () => {
    const { db, shop } = await context();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const tech = await diver(db, shop.id, "Theo Bench");
    const reg = await piece(db, shop.id, maya.id);
    const ticket = await readyTicket(db, shop.id, maya.id, reg.id);
    const email = fakeEmail();
    await sendWorkOrderReadyNotice(
      db,
      { shopId: shop.id, workOrderId: ticket.id },
      { emailProvider: email.provider },
    );

    const resent = await sendWorkOrderReadyNotice(
      db,
      { shopId: shop.id, workOrderId: ticket.id, resendByPersonId: tech.id },
      { emailProvider: email.provider },
    );
    expect(resent).toEqual({ ok: true, status: "sent", channel: "email" });
    expect(email.sent).toHaveLength(2);
    expect((await latestReadyNotice(db, shop.id, ticket.id))?.sentByPersonId).toBe(tech.id);
  });

  it("texts a customer with a phone and no email, over the shop's WhatsApp when it has one", async () => {
    const { db, shop } = await context();
    const sam = await diver(db, shop.id, "Sam Tide", { email: null, phone: "+13055550142" });
    const reg = await piece(db, shop.id, sam.id);
    const ticket = await readyTicket(db, shop.id, sam.id, reg.id);
    const sms = fakeSms();
    const whatsapp = fakeCourtesy();

    const outcome = await sendWorkOrderReadyNotice(
      db,
      { shopId: shop.id, workOrderId: ticket.id },
      { smsProvider: sms.provider, whatsAppProviders: new Map([[shop.id, whatsapp.provider]]) },
    );

    expect(outcome).toEqual({ ok: true, status: "sent", channel: "whatsapp" });
    expect(sms.sent).toHaveLength(0);
    expect(whatsapp.sent[0]?.body).toContain("Bench Divers: your gear is ready to collect");
    expect(whatsapp.sent[0]?.body).toContain("regulator (Apeks XTX200)");
    expect(whatsapp.sent[0]?.body).toContain("What we did: Serviced both stages");
  });

  it("falls back to SMS, with the stop line, when the shop has no WhatsApp", async () => {
    const { db, shop } = await context();
    const sam = await diver(db, shop.id, "Sam Tide", { email: null, phone: "+13055550142" });
    const reg = await piece(db, shop.id, sam.id);
    const ticket = await readyTicket(db, shop.id, sam.id, reg.id);
    const sms = fakeSms();

    const outcome = await sendWorkOrderReadyNotice(
      db,
      { shopId: shop.id, workOrderId: ticket.id },
      { smsProvider: sms.provider, whatsAppProviders: new Map() },
    );

    expect(outcome).toEqual({ ok: true, status: "sent", channel: "sms" });
    expect(sms.sent[0]?.body).toMatch(/Reply STOP to opt out\.$/);
  });

  it("records that there was nobody to reach, so the ticket can say so", async () => {
    const { db, shop } = await context();
    const lee = await diver(db, shop.id, "Lee Quiet", { email: null });
    const reg = await piece(db, shop.id, lee.id);
    const ticket = await readyTicket(db, shop.id, lee.id, reg.id);

    expect(
      await sendWorkOrderReadyNotice(
        db,
        { shopId: shop.id, workOrderId: ticket.id },
        { whatsAppProviders: new Map() },
      ),
    ).toEqual({ ok: true, status: "no_contact", channel: null });
    expect((await latestReadyNotice(db, shop.id, ticket.id))?.status).toBe("no_contact");
  });

  it("says nothing about the shop's own unit", async () => {
    const { db, shop } = await context();
    const unit = await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #9" });
    if (!unit.ok) throw new Error("unit insert failed");
    const opened = await createWorkOrder(db, {
      shopId: shop.id,
      gearItemId: unit.item.id,
      reportedProblem: "Second stage leaks",
    });
    if (!opened.ok) throw new Error("ticket refused");
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: opened.workOrder.id,
      status: "ready",
      todayLocal: TODAY,
    });
    const email = fakeEmail();

    expect(
      await sendWorkOrderReadyNotice(
        db,
        { shopId: shop.id, workOrderId: opened.workOrder.id },
        { emailProvider: email.provider },
      ),
    ).toEqual({ ok: false, reason: "not_customer" });
    expect(email.sent).toHaveLength(0);
  });

  it("refuses a resend once the ticket is no longer ready", async () => {
    const { db, shop } = await context();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const reg = await piece(db, shop.id, maya.id);
    const ticket = await readyTicket(db, shop.id, maya.id, reg.id);
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      status: "picked_up",
      todayLocal: TODAY,
    });

    expect(
      await sendWorkOrderReadyNotice(db, {
        shopId: shop.id,
        workOrderId: ticket.id,
        resendByPersonId: maya.id,
      }),
    ).toEqual({ ok: false, reason: "not_ready" });
  });

  it("never reaches another shop's ticket", async () => {
    const { db, shop, demo } = await context();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const reg = await piece(db, shop.id, maya.id);
    const ticket = await readyTicket(db, shop.id, maya.id, reg.id);

    expect(await sendWorkOrderReadyNotice(db, { shopId: demo.id, workOrderId: ticket.id })).toEqual(
      { ok: false, reason: "not_found" },
    );
  });
});

function fakeInvoicing(): InvoicingProvider & { created: CreateInvoiceRequest[] } {
  const created: CreateInvoiceRequest[] = [];
  return {
    created,
    async createInvoice(request): Promise<CreateInvoiceResult> {
      created.push(request);
      const n = created.length;
      return {
        status: "created",
        stripeCustomerId: `cus_wo_${n}`,
        stripeInvoiceId: `in_wo_${n}`,
        stripeStatus: "open",
        hostedInvoiceUrl: `https://invoice.stripe.com/i/in_wo_${n}`,
        invoicePdfUrl: null,
        totalCents: request.lineItems.reduce(
          (sum, item) => sum + item.quantity * item.unitAmountCents,
          0,
        ),
        taxCents: 0,
      };
    },
    async voidInvoice() {
      return { status: "voided" };
    },
    async resendInvoice() {
      return { status: "sent" };
    },
    async refundInvoice() {
      return { status: "failed" };
    },
    async retrieveInvoice() {
      return { status: "failed" };
    },
  };
}

async function billingContext() {
  // The demo shop, for its seeded owner and captain: `createOrder` re-reads
  // roles, and billing is owner or manager work.
  const { db, demo: shop } = await context();
  await upsertShopStripeAccount(db, shop.id, "acct_bench");
  await setShopStripeAccountStatus(db, "acct_bench", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const maya = await diver(db, shop.id, "Maya Bill");
  const reg = await piece(db, shop.id, maya.id);
  const ticket = await readyTicket(db, shop.id, maya.id, reg.id);
  return { db, shop, owner, maya, ticket };
}

const LINES = [
  { kind: "other" as const, description: "O-ring kit", quantity: 2, unitAmountCents: 1250 },
  { kind: "other" as const, description: "Bench time (1.5)", quantity: 1, unitAmountCents: 9000 },
];

describe("sending the bill", () => {
  it("raises one Stripe order from the ticket's lines and links it", async () => {
    const { db, shop, owner, ticket } = await billingContext();
    const invoicing = fakeInvoicing();

    const outcome = await billWorkOrder(
      db,
      {
        shopId: shop.id,
        workOrderId: ticket.id,
        actorPersonId: owner,
        description: "Service ticket",
        lineItems: LINES,
      },
      invoicing,
    );

    expect(outcome.ok).toBe(true);
    expect(invoicing.created).toHaveLength(1);
    const bill = await getWorkOrderBill(db, shop.id, ticket.id);
    expect(bill).toMatchObject({ status: "open", totalCents: 11_500 });
  });

  it("refuses a second bill while the first is open, and allows one after a void", async () => {
    const { db, shop, owner, ticket } = await billingContext();
    const invoicing = fakeInvoicing();
    const send = () =>
      billWorkOrder(
        db,
        {
          shopId: shop.id,
          workOrderId: ticket.id,
          actorPersonId: owner,
          description: "Service ticket",
          lineItems: LINES,
        },
        invoicing,
      );
    await send();

    expect(await send()).toEqual({ ok: false, reason: "already_billed" });
    expect(invoicing.created).toHaveLength(1);

    await markOrderVoidedByInvoiceId(db, "in_wo_1");
    const again = await send();
    expect(again.ok).toBe(true);
    expect(invoicing.created).toHaveLength(2);
  });

  it("keeps createOrder's own rule: a captain cannot bill", async () => {
    const { db, shop, ticket } = await billingContext();
    const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
    const invoicing = fakeInvoicing();

    expect(
      await billWorkOrder(
        db,
        {
          shopId: shop.id,
          workOrderId: ticket.id,
          actorPersonId: captain,
          description: "Service ticket",
          lineItems: LINES,
        },
        invoicing,
      ),
    ).toEqual({ ok: false, reason: "not_authorized" });
    expect(invoicing.created).toHaveLength(0);
    expect(await getWorkOrderBill(db, shop.id, ticket.id)).toBeNull();
  });

  it("refuses an empty bill and a bench ticket", async () => {
    const { db, shop, owner, ticket } = await billingContext();
    expect(
      await billWorkOrder(
        db,
        {
          shopId: shop.id,
          workOrderId: ticket.id,
          actorPersonId: owner,
          description: "Service ticket",
          lineItems: [],
        },
        fakeInvoicing(),
      ),
    ).toEqual({ ok: false, reason: "no_lines" });

    const unit = await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-T9" });
    if (!unit.ok) throw new Error("unit insert failed");
    const bench = await createWorkOrder(db, {
      shopId: shop.id,
      gearItemId: unit.item.id,
      reportedProblem: "Visual due",
    });
    if (!bench.ok) throw new Error("ticket refused");
    expect(
      await billWorkOrder(
        db,
        {
          shopId: shop.id,
          workOrderId: bench.workOrder.id,
          actorPersonId: owner,
          description: "Service ticket",
          lineItems: LINES,
        },
        fakeInvoicing(),
      ),
    ).toEqual({ ok: false, reason: "not_customer" });
  });
});

describe("service-due reminders", () => {
  it("reminds about a date a month out, once, however many times the pass runs", async () => {
    const { db, shop } = await context();
    const maya = await diver(db, shop.id, "Maya Remind");
    await piece(db, shop.id, maya.id, { serviceDueOn: "2026-08-15" });
    const email = fakeEmail();
    const run = () =>
      sendDueServiceReminders(db, {
        now: nowDate(),
        emailProvider: email.provider,
        smsProvider: fakeSms().provider,
        whatsAppProviders: new Map(),
        appOrigin: "https://diveday.test",
      });

    await run();
    await run();

    const mine = onlyTo(email.sent, maya.email ?? "");
    expect(mine).toHaveLength(1);
    const [sent] = mine;
    expect(sent?.kind).toBe("gear_service_due");
    if (sent?.kind !== "gear_service_due") return;
    expect(sent).toMatchObject({ clock: "service", dueOn: "2026-08-15", shopName: "Bench Divers" });
    expect(sent.unsubscribeUrl).toMatch(/^https:\/\/diveday\.test\/unsubscribe\//);
  });

  it("reminds again when the piece gets a new date", async () => {
    const { db, shop } = await context();
    const maya = await diver(db, shop.id, "Maya Remind");
    const reg = await piece(db, shop.id, maya.id, { serviceDueOn: "2026-08-15" });
    const email = fakeEmail();
    const run = () =>
      sendDueServiceReminders(db, {
        emailProvider: email.provider,
        whatsAppProviders: new Map(),
        appOrigin: "https://diveday.test",
      });
    await run();
    await db
      .update(customerGearItems)
      .set({ serviceDueOn: "2026-08-10" })
      .where(eq(customerGearItems.id, reg.id));
    await run();

    expect(onlyTo(email.sent, maya.email ?? "")).toHaveLength(2);
    expect((await lastServiceReminders(db, shop.id, [reg.id])).get(reg.id)?.dueOn).toBe(
      "2026-08-10",
    );
  });

  it("waits while the date is more than a month away, and never reminds about a date gone", async () => {
    const { db, shop } = await context();
    const maya = await diver(db, shop.id, "Maya Remind");
    await piece(db, shop.id, maya.id, { serviceDueOn: "2026-09-30" });
    await piece(db, shop.id, maya.id, { kind: "bcd", serviceDueOn: "2026-07-01" });
    const email = fakeEmail();

    await sendDueServiceReminders(db, {
      emailProvider: email.provider,
      whatsAppProviders: new Map(),
      appOrigin: "https://diveday.test",
    });
    expect(onlyTo(email.sent, maya.email ?? "")).toHaveLength(0);
  });

  it("skips a piece with reminders off, a deleted piece, and a piece on the bench", async () => {
    const { db, shop } = await context();
    const maya = await diver(db, shop.id, "Maya Remind");
    const off = await piece(db, shop.id, maya.id, { serviceDueOn: "2026-08-15" });
    const gone = await piece(db, shop.id, maya.id, { kind: "bcd", serviceDueOn: "2026-08-15" });
    const held = await piece(db, shop.id, maya.id, { kind: "tank", serviceDueOn: "2026-08-15" });
    await setCustomerGearReminders(db, { shopId: shop.id, customerGearItemId: off.id, on: false });
    await deleteCustomerGearItem(db, { shopId: shop.id, customerGearItemId: gone.id });
    await createWorkOrder(db, {
      shopId: shop.id,
      personId: maya.id,
      customerGearItemIds: [held.id],
      reportedProblem: "Visual",
    });
    const email = fakeEmail();

    const summary = await sendDueServiceReminders(db, {
      emailProvider: email.provider,
      whatsAppProviders: new Map(),
      appOrigin: "https://diveday.test",
    });
    expect(onlyTo(email.sent, maya.email ?? "")).toHaveLength(0);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(await piecesWithRemindersOff(db, shop.id, [off.id, gone.id])).toEqual(new Set([off.id]));

    // Back on, it is reminded on the next pass.
    await setCustomerGearReminders(db, { shopId: shop.id, customerGearItemId: off.id, on: true });
    await sendDueServiceReminders(db, {
      emailProvider: email.provider,
      whatsAppProviders: new Map(),
      appOrigin: "https://diveday.test",
    });
    expect(onlyTo(email.sent, maya.email ?? "")).toHaveLength(1);
  });

  it("texts instead of emailing someone who turned optional email off, and leaves them be with no phone", async () => {
    const { db, shop } = await context();
    const texted = await diver(db, shop.id, "Ana Text", { phone: "+13055550199" });
    const silent = await diver(db, shop.id, "Bo Silent");
    for (const person of [texted, silent]) {
      await db
        .update(people)
        .set({ courtesyEmailOptOutAt: nowDate() })
        .where(eq(people.id, person.id));
      await piece(db, shop.id, person.id, { serviceDueOn: "2026-08-15" });
    }
    const email = fakeEmail();
    const sms = fakeSms();

    const summary = await sendDueServiceReminders(db, {
      emailProvider: email.provider,
      smsProvider: sms.provider,
      whatsAppProviders: new Map(),
      appOrigin: "https://diveday.test",
    });

    expect(onlyTo(email.sent, texted.email ?? "")).toHaveLength(0);
    expect(onlyTo(email.sent, silent.email ?? "")).toHaveLength(0);
    const mine = sms.sent.filter((message) => message.to === "+13055550199");
    expect(mine).toHaveLength(1);
    expect(mine[0]?.body).toContain(
      "Bench Divers: Service on your regulator (Apeks XTX200) is due on",
    );
    expect(summary.optedOut).toBeGreaterThanOrEqual(1);
    const rows = await db
      .select()
      .from(customerGearNotices)
      .where(
        and(eq(customerGearNotices.shopId, shop.id), eq(customerGearNotices.personId, silent.id)),
      );
    expect(rows).toHaveLength(0);
  });

  it("holds a due reminder for the shop's own morning", async () => {
    const { db, shop } = await context();
    const maya = await diver(db, shop.id, "Maya Remind");
    await piece(db, shop.id, maya.id, { serviceDueOn: "2026-08-15" });
    const email = fakeEmail();
    // 03:30 in New York.
    const night = new Date(nowDate().getTime() - 6 * 60 * 60 * 1000);

    await sendDueServiceReminders(db, {
      now: night,
      emailProvider: email.provider,
      whatsAppProviders: new Map(),
      appOrigin: "https://diveday.test",
    });
    expect(onlyTo(email.sent, maya.email ?? "")).toHaveLength(0);
  });

  it("names a cylinder's clock as its visual inspection", async () => {
    const { db, shop } = await context();
    const maya = await diver(db, shop.id, "Maya Remind");
    await piece(db, shop.id, maya.id, { kind: "tank", serviceDueOn: "2026-08-01" });
    const email = fakeEmail();
    await sendDueServiceReminders(db, {
      emailProvider: email.provider,
      whatsAppProviders: new Map(),
      appOrigin: "https://diveday.test",
    });
    const [sent] = onlyTo(email.sent, maya.email ?? "");
    expect(sent?.kind === "gear_service_due" && sent.clock).toBe("visual_inspection");
  });
});

describe("what Today asks about the bench", () => {
  it("lists a ticket past its promised day and one ready a week without collection", async () => {
    const { db, shop } = await context();
    const maya = await diver(db, shop.id, "Maya Late");
    const reg = await piece(db, shop.id, maya.id);
    const late = await createWorkOrder(db, {
      shopId: shop.id,
      personId: maya.id,
      customerGearItemIds: [reg.id],
      reportedProblem: "Leaks",
      promisedOn: "2026-07-18",
    });
    if (!late.ok) throw new Error("ticket refused");
    const bcd = await piece(db, shop.id, maya.id, { kind: "bcd" });
    const ready = await readyTicket(db, shop.id, maya.id, bcd.id);

    const now = await listWorkOrdersNeedingAttention(db, shop.id, {
      todayLocal: TODAY,
      timezone: shop.timezone,
    });
    expect(now).toEqual([
      {
        workOrderId: late.workOrder.id,
        reason: "past_promise",
        status: "received",
        subject: "Maya Late",
        since: "2026-07-18",
      },
    ]);

    const weekOn = await listWorkOrdersNeedingAttention(db, shop.id, {
      todayLocal: "2026-07-28",
      timezone: shop.timezone,
    });
    expect(weekOn.map((row) => [row.workOrderId, row.reason])).toEqual([
      [late.workOrder.id, "past_promise"],
      [ready.id, "uncollected"],
    ]);
  });
});
