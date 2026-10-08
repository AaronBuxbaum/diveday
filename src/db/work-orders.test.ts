import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/authz";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import type { AppDb } from "./client";
import { createDiver } from "./divers";
import {
  createGearItem,
  getGearItemDetail,
  latestServiceClocks,
  openServiceConcerns,
} from "./gear";
import {
  customerGearItems,
  gearItems,
  gearReservations,
  gearServiceEvents,
  people,
  personRoles,
  shops,
  userAccounts,
  workOrderCare,
  workOrderLines,
  workOrders,
} from "./schema";
import {
  addCustomerGearItem,
  addWorkOrderLine,
  countWorkOrders,
  createWorkOrder,
  deleteCustomerGearItem,
  deleteWorkOrder,
  deleteWorkOrderLine,
  getWorkOrderDetail,
  listCustomerGearItems,
  listDeletedWorkOrders,
  listWorkOrdersForPerson,
  recordWorkOrderWork,
  restoreCustomerGearItem,
  restoreWorkOrder,
  saveWorkOrder,
  setWorkOrderStatus,
  updateCustomerGearItem,
  updateWorkOrderLine,
  workOrderBoard,
} from "./work-orders";

const TODAY = "2026-10-08";

/**
 * A shop of this suite's own, for the reason `gear.test.ts` keeps one: the
 * seeded demo now ships work orders of its own, and asserting counts against
 * it would pin the demo's bench. A fresh shop keeps every assertion about the
 * rows the test wrote, and doubles as proof the readers are shop-scoped.
 */
async function workOrderShopContext() {
  const { db } = await seededShopContext();
  const [shop] = await db
    .insert(shops)
    .values({ name: "Work Order Divers", slug: "work-order-test", timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("work order test shop insert failed");
  return { db, shop };
}

async function diver(db: AppDb, shopId: string, fullName: string) {
  const person = await createDiver(db, {
    shopId,
    fullName,
    email: `${fullName.toLowerCase().replace(/[^a-z]+/g, "-")}@example.com`,
  });
  if (!person) throw new Error("diver insert failed");
  return person;
}

/** A member of the shop's staff — the only kind of person a ticket may be handed to. */
async function staff(db: AppDb, shopId: string, fullName: string, role: Role = "instructor") {
  const [person] = await db.insert(people).values({ shopId, fullName }).returning();
  if (!person) throw new Error("staff insert failed");
  await db.insert(personRoles).values({ personId: person.id, role });
  return person;
}

/** A diver the shop removed and erased, the way the record's own erase leaves them. */
async function erased(db: AppDb, shopId: string, personId: string) {
  // Erasure is owner-only and checks for a live account, as it does in the app.
  const owner = await staff(db, shopId, "Olu Owner", "owner");
  await db.insert(userAccounts).values({
    personId: owner.id,
    email: `owner.${owner.id}@example.com`,
    hashedPassword: "x",
    status: "active",
  });
  const outcome = await anonymizeDiver(db, { shopId, personId, actorPersonId: owner.id });
  if (!outcome.ok) throw new Error(`erase refused: ${outcome.reason}`);
}

async function rivalShop(db: AppDb, slug: string) {
  const [rival] = await db
    .insert(shops)
    .values({ name: "Rival Reef", slug, timezone: "America/New_York" })
    .returning();
  if (!rival) throw new Error("rival shop insert failed");
  return rival;
}

async function unitStatus(db: AppDb, gearItemId: string) {
  const [row] = await db
    .select({ status: gearItems.status, serviceNote: gearItems.serviceNote })
    .from(gearItems)
    .where(eq(gearItems.id, gearItemId));
  return row;
}

async function customerPiece(
  db: AppDb,
  shopId: string,
  personId: string,
  kind: "regulator" | "bcd" | "wetsuit" = "regulator",
) {
  const outcome = await addCustomerGearItem(db, {
    shopId,
    personId,
    kind,
    brandModel: "Apeks XTX200",
    serialNumber: "AP-9001",
  });
  if (!outcome.ok) throw new Error(`piece refused: ${outcome.reason}`);
  return outcome.item;
}

async function customerTicket(db: AppDb, shopId: string, personId: string, pieceId: string) {
  const outcome = await createWorkOrder(db, {
    shopId,
    personId,
    customerGearItemIds: [pieceId],
    reportedProblem: "Free-flows at depth",
  });
  if (!outcome.ok) throw new Error(`ticket refused: ${outcome.reason}`);
  return outcome.workOrder;
}

describe("a customer's own gear", () => {
  it("records a piece on the diver's record and reads it back", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    expect(piece.kind).toBe("regulator");
    expect(await listCustomerGearItems(db, shop.id, maya.id)).toHaveLength(1);
  });

  it("refuses a service-due date that is not a date", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const outcome = await addCustomerGearItem(db, {
      shopId: shop.id,
      personId: maya.id,
      kind: "regulator",
      serviceDueOn: "next spring",
    });
    expect(outcome).toEqual({ ok: false, reason: "invalid_date" });
  });

  it("lets staff edit the next-service date a ticket suggested", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const outcome = await updateCustomerGearItem(db, {
      shopId: shop.id,
      customerGearItemId: piece.id,
      kind: "regulator",
      serviceDueOn: "2027-06-01",
    });
    expect(outcome.ok && outcome.item.serviceDueOn).toBe("2027-06-01");
  });

  it("gives a cylinder its two dates and never a service date", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const outcome = await addCustomerGearItem(db, {
      shopId: shop.id,
      personId: maya.id,
      kind: "tank",
      serviceDueOn: "2027-01-01",
      inspectionDueOn: "2027-03-01",
      hydroDueOn: "2030-03-01",
    });
    if (!outcome.ok) throw new Error("tank refused");
    expect(outcome.item.serviceDueOn).toBeNull();
    expect(outcome.item.inspectionDueOn).toBe("2027-03-01");
    expect(outcome.item.hydroDueOn).toBe("2030-03-01");
  });

  it("refuses a piece for a person of another shop, writing nothing", async () => {
    const { db, shop } = await workOrderShopContext();
    const rival = await rivalShop(db, "rival-work-orders-piece");
    const outsider = await diver(db, rival.id, "Out Sider");
    expect(
      await addCustomerGearItem(db, { shopId: shop.id, personId: outsider.id, kind: "regulator" }),
    ).toEqual({ ok: false, reason: "not_found" });
    const rows = await db
      .select()
      .from(customerGearItems)
      .where(eq(customerGearItems.personId, outsider.id));
    expect(rows).toHaveLength(0);
  });

  it("refuses to add to or edit the gear of a diver the shop erased", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    await erased(db, shop.id, maya.id);
    expect(
      await addCustomerGearItem(db, { shopId: shop.id, personId: maya.id, kind: "bcd" }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await updateCustomerGearItem(db, {
        shopId: shop.id,
        customerGearItemId: piece.id,
        kind: "regulator",
        note: "new words",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("deletes a piece softly, keeps it off the live list, and restores it", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);

    const deleted = await deleteCustomerGearItem(db, {
      shopId: shop.id,
      customerGearItemId: piece.id,
      deletedByPersonId: maya.id,
    });
    expect(deleted.ok).toBe(true);
    expect(await listCustomerGearItems(db, shop.id, maya.id)).toHaveLength(0);
    const [row] = await db
      .select()
      .from(customerGearItems)
      .where(eq(customerGearItems.id, piece.id));
    expect(row?.deletedAt).not.toBeNull();

    expect(
      (await restoreCustomerGearItem(db, { shopId: shop.id, customerGearItemId: piece.id })).ok,
    ).toBe(true);
    expect(await listCustomerGearItems(db, shop.id, maya.id)).toHaveLength(1);
  });

  it("refuses to delete a piece that is on an open ticket", async () => {
    // The shop physically has it; hiding the row would leave a technician
    // holding a regulator the record no longer admits to.
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    await customerTicket(db, shop.id, maya.id, piece.id);

    expect(
      await deleteCustomerGearItem(db, { shopId: shop.id, customerGearItemId: piece.id }),
    ).toEqual({ ok: false, reason: "on_open_work_order" });
  });

  it("lets the piece go once the ticket is collected", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      status: "picked_up",
    });
    expect(
      (await deleteCustomerGearItem(db, { shopId: shop.id, customerGearItemId: piece.id })).ok,
    ).toBe(true);
  });

  it("keeps another shop's pieces out of this shop's reads and writes", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-work-orders", timezone: "America/New_York" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");

    expect(await listCustomerGearItems(db, rival.id, maya.id)).toEqual([]);
    expect(
      await updateCustomerGearItem(db, {
        shopId: rival.id,
        customerGearItemId: piece.id,
        kind: "bcd",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await deleteCustomerGearItem(db, { shopId: rival.id, customerGearItemId: piece.id }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("opening a ticket", () => {
  it("opens a customer ticket with its pieces and a created event", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const outcome = await createWorkOrder(db, {
      shopId: shop.id,
      personId: maya.id,
      customerGearItemIds: [piece.id],
      reportedProblem: "Free-flows at depth",
      promisedOn: "2026-10-15",
      actorPersonId: maya.id,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const detail = await getWorkOrderDetail(db, shop.id, outcome.workOrder.id, {
      todayLocal: TODAY,
    });
    expect(detail?.workOrder.status).toBe("received");
    expect(detail?.personName).toBe("Maya Pressure");
    expect(detail?.pieces.map((piece) => piece.id)).toEqual([piece.id]);
    expect(detail?.events.map((event) => event.kind)).toEqual(["created"]);
    expect(detail?.totalCents).toBe(0);
  });

  it("opens a bench ticket on one of the shop's own units", async () => {
    const { db, shop } = await workOrderShopContext();
    const unit = await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #9" });
    if (!unit.ok) throw new Error("unit insert failed");
    const outcome = await createWorkOrder(db, {
      shopId: shop.id,
      gearItemId: unit.item.id,
      reportedProblem: "Second stage leaks",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const detail = await getWorkOrderDetail(db, shop.id, outcome.workOrder.id, {
      todayLocal: TODAY,
    });
    expect(detail?.gearItemLabel).toBe("Reg #9");
    expect(detail?.personName).toBeNull();
    // The unit is off the wall for as long as it is on the bench, with the
    // problem as the note a packer reads.
    expect(await unitStatus(db, unit.item.id)).toEqual({
      status: "needs_service",
      serviceNote: "Second stage leaks",
    });
  });

  it("numbers tickets per shop from 1, and never reuses a deleted one's number", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const first = await customerTicket(db, shop.id, maya.id, piece.id);
    const second = await customerTicket(db, shop.id, maya.id, piece.id);
    expect([first.number, second.number]).toEqual([1, 2]);
    await deleteWorkOrder(db, { shopId: shop.id, workOrderId: second.id });
    const third = await customerTicket(db, shop.id, maya.id, piece.id);
    expect(third.number).toBe(3);

    const rival = await rivalShop(db, "rival-work-orders-numbers");
    const sam = await diver(db, rival.id, "Sam Surface");
    const theirs = await customerPiece(db, rival.id, sam.id);
    expect((await customerTicket(db, rival.id, sam.id, theirs.id)).number).toBe(1);
  });

  it("refuses a customer from another shop, or one the shop erased", async () => {
    const { db, shop } = await workOrderShopContext();
    const rival = await rivalShop(db, "rival-work-orders-customer");
    const outsider = await diver(db, rival.id, "Out Sider");
    const theirPiece = await customerPiece(db, rival.id, outsider.id);
    expect(
      await createWorkOrder(db, {
        shopId: shop.id,
        personId: outsider.id,
        customerGearItemIds: [theirPiece.id],
        reportedProblem: "Leaks",
      }),
    ).toEqual({ ok: false, reason: "not_found" });

    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    await erased(db, shop.id, maya.id);
    expect(
      await createWorkOrder(db, {
        shopId: shop.id,
        personId: maya.id,
        customerGearItemIds: [piece.id],
        reportedProblem: "Leaks",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("hands a new ticket only to a live member of this shop's staff", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const rival = await rivalShop(db, "rival-work-orders-new-tech");
    const outsider = await staff(db, rival.id, "Outside Tech");
    const open = (technicianPersonId: string) =>
      createWorkOrder(db, {
        shopId: shop.id,
        personId: maya.id,
        customerGearItemIds: [piece.id],
        reportedProblem: "Leaks",
        technicianPersonId,
      });
    expect(await open(outsider.id)).toEqual({ ok: false, reason: "unknown_technician" });
    expect(await open(maya.id)).toEqual({ ok: false, reason: "unknown_technician" });
    const tech = await staff(db, shop.id, "Theo Bench");
    expect((await open(tech.id)).ok).toBe(true);
  });

  it("refuses a ticket with no subject, two subjects, or no pieces", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const unit = await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #9" });
    if (!unit.ok) throw new Error("unit insert failed");

    expect(await createWorkOrder(db, { shopId: shop.id, reportedProblem: "Something" })).toEqual({
      ok: false,
      reason: "no_subject",
    });
    expect(
      await createWorkOrder(db, {
        shopId: shop.id,
        personId: maya.id,
        gearItemId: unit.item.id,
        reportedProblem: "Something",
      }),
    ).toEqual({ ok: false, reason: "two_subjects" });
    expect(
      await createWorkOrder(db, {
        shopId: shop.id,
        personId: maya.id,
        customerGearItemIds: [],
        reportedProblem: "Something",
      }),
    ).toEqual({ ok: false, reason: "no_items" });
  });

  it("refuses an empty problem and an unreadable promised date", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    expect(
      await createWorkOrder(db, {
        shopId: shop.id,
        personId: maya.id,
        customerGearItemIds: [piece.id],
        reportedProblem: "   ",
      }),
    ).toEqual({ ok: false, reason: "empty_problem" });
    expect(
      await createWorkOrder(db, {
        shopId: shop.id,
        personId: maya.id,
        customerGearItemIds: [piece.id],
        reportedProblem: "Free-flows",
        promisedOn: "soon",
      }),
    ).toEqual({ ok: false, reason: "invalid_date" });
  });

  it("refuses a piece that belongs to somebody else", async () => {
    // A stale tab must not be able to put another diver's regulator on this
    // ticket, which is also how the diver's name would reach the wrong record.
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const sam = await diver(db, shop.id, "Sam Surface");
    const theirs = await customerPiece(db, shop.id, sam.id);
    expect(
      await createWorkOrder(db, {
        shopId: shop.id,
        personId: maya.id,
        customerGearItemIds: [theirs.id],
        reportedProblem: "Free-flows",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    // Nothing was written by the refused attempt.
    const rows = await db.select().from(workOrders).where(eq(workOrders.shopId, shop.id));
    expect(rows).toHaveLength(0);
  });

  it("refuses a unit from another shop", async () => {
    const { db, shop } = await workOrderShopContext();
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-work-orders-2", timezone: "America/New_York" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    const unit = await createGearItem(db, { shopId: rival.id, kind: "bcd", label: "BCD #r" });
    if (!unit.ok) throw new Error("unit insert failed");
    expect(
      await createWorkOrder(db, {
        shopId: shop.id,
        gearItemId: unit.item.id,
        reportedProblem: "Leaks",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("moving a ticket", () => {
  it("records every move in history and stamps ready and picked up", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);

    for (const status of ["in_progress", "waiting_on_parts", "ready", "picked_up"] as const) {
      expect(
        (
          await setWorkOrderStatus(db, {
            shopId: shop.id,
            workOrderId: ticket.id,
            status,
          })
        ).ok,
      ).toBe(true);
    }

    const detail = await getWorkOrderDetail(db, shop.id, ticket.id, { todayLocal: TODAY });
    expect(detail?.workOrder.status).toBe("picked_up");
    expect(detail?.workOrder.readyAt).not.toBeNull();
    expect(detail?.workOrder.pickedUpAt).not.toBeNull();
    expect(detail?.events.map((event) => event.toStatus)).toEqual([
      "received",
      "in_progress",
      "waiting_on_parts",
      "ready",
      "picked_up",
    ]);
  });

  it("keeps the first ready stamp when a ticket goes back on the bench", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    const first = await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      status: "ready",
    });
    if (!first.ok) throw new Error("move refused");
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      status: "in_progress",
    });
    const again = await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      status: "ready",
    });
    expect(again.ok && again.workOrder.readyAt?.getTime()).toBe(first.workOrder.readyAt?.getTime());
  });

  it("refuses a move to the status it is already on, and any move off picked up", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    expect(
      await setWorkOrderStatus(db, {
        shopId: shop.id,
        workOrderId: ticket.id,
        status: "received",
      }),
    ).toEqual({ ok: false, reason: "already" });
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      status: "picked_up",
    });
    expect(
      await setWorkOrderStatus(db, {
        shopId: shop.id,
        workOrderId: ticket.id,
        status: "in_progress",
      }),
    ).toEqual({ ok: false, reason: "closed" });
  });

  it("saves what came in, the bench notes and the technician in one write", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const tech = await staff(db, shop.id, "Theo Bench");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);

    const saved = await saveWorkOrder(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      reportedProblem: "Free-flows below 20 m",
      promisedOn: "2026-10-20",
      technicianPersonId: tech.id,
      technicianNotes: "Seat worn, diaphragm fine",
      workPerformed: "Replaced the second-stage seat and retuned",
    });
    expect(saved.ok).toBe(true);
    const detail = await getWorkOrderDetail(db, shop.id, ticket.id, { todayLocal: TODAY });
    expect(detail?.workOrder.reportedProblem).toBe("Free-flows below 20 m");
    expect(detail?.workOrder.promisedOn).toBe("2026-10-20");
    expect(detail?.technicianName).toBe("Theo Bench");
    // Bench notes and what the customer is told stay two fields.
    expect(detail?.workOrder.technicianNotes).toBe("Seat worn, diaphragm fine");
    expect(detail?.workOrder.workPerformed).toBe("Replaced the second-stage seat and retuned");
  });

  it("records a hand-over only when the technician actually changes", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const tech = await staff(db, shop.id, "Theo Bench");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    const base = { shopId: shop.id, workOrderId: ticket.id, reportedProblem: "Leaks" };
    const handOvers = async () =>
      (await getWorkOrderDetail(db, shop.id, ticket.id, { todayLocal: TODAY }))?.events.filter(
        (event) => event.kind === "technician_assigned",
      ) ?? [];

    // Saving the notes with nobody on the ticket hands it to nobody.
    await saveWorkOrder(db, { ...base, technicianPersonId: null });
    expect(await handOvers()).toHaveLength(0);

    await saveWorkOrder(db, { ...base, technicianPersonId: tech.id });
    // A second save that leaves the technician alone is a notes edit, not a hand-over.
    await saveWorkOrder(db, {
      ...base,
      technicianPersonId: tech.id,
      technicianNotes: "Ordered kit",
    });
    expect(await handOvers()).toHaveLength(1);

    await saveWorkOrder(db, { ...base, technicianPersonId: null });
    const events = await handOvers();
    expect(events).toHaveLength(2);
    expect(events.at(-1)?.technicianPersonId).toBeNull();
  });

  it("refuses an empty problem, a bad date and another shop's person, writing nothing", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    const rival = await rivalShop(db, "rival-work-orders-tech");
    const outsider = await staff(db, rival.id, "Outside Tech");
    // A diver of this very shop is not staff, so not somebody to hand gear to.
    const sam = await diver(db, shop.id, "Sam Surface");
    const base = { shopId: shop.id, workOrderId: ticket.id, technicianPersonId: null };

    expect(
      await saveWorkOrder(db, { ...base, reportedProblem: "   ", technicianNotes: "lost" }),
    ).toEqual({ ok: false, reason: "empty_problem" });
    expect(
      await saveWorkOrder(db, { ...base, reportedProblem: "Leaks", promisedOn: "2026-13-40" }),
    ).toEqual({ ok: false, reason: "invalid_date" });
    expect(
      await saveWorkOrder(db, {
        ...base,
        reportedProblem: "Leaks",
        technicianPersonId: outsider.id,
        technicianNotes: "lost",
      }),
    ).toEqual({ ok: false, reason: "unknown_technician" });
    expect(
      await saveWorkOrder(db, { ...base, reportedProblem: "Leaks", technicianPersonId: sam.id }),
    ).toEqual({ ok: false, reason: "unknown_technician" });

    const detail = await getWorkOrderDetail(db, shop.id, ticket.id, { todayLocal: TODAY });
    expect(detail?.workOrder.technicianNotes).toBeNull();
    expect(detail?.workOrder.technicianPersonId).toBeNull();
  });

  it("refuses every write from another shop", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-work-orders-3", timezone: "America/New_York" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");

    expect(
      await setWorkOrderStatus(db, {
        shopId: rival.id,
        workOrderId: ticket.id,
        status: "ready",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await saveWorkOrder(db, {
        shopId: rival.id,
        workOrderId: ticket.id,
        reportedProblem: "nothing",
        technicianPersonId: null,
        workPerformed: "nothing",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await getWorkOrderDetail(db, rival.id, ticket.id, { todayLocal: TODAY })).toBeNull();
  });
});

describe("the Work done record, the only path to a clock", () => {
  async function benchTicket(kind: "regulator" | "tank" | "wetsuit", label: string) {
    const { db, shop } = await workOrderShopContext();
    const unit = await createGearItem(db, { shopId: shop.id, kind, label });
    if (!unit.ok) throw new Error("unit insert failed");
    const opened = await createWorkOrder(db, {
      shopId: shop.id,
      gearItemId: unit.item.id,
      reportedProblem: "Annual check",
    });
    if (!opened.ok) throw new Error("ticket refused");
    return { db, shop, unit: unit.item, ticket: opened.workOrder };
  }

  async function serviceEvents(db: AppDb, gearItemId: string) {
    return db.select().from(gearServiceEvents).where(eq(gearServiceEvents.gearItemId, gearItemId));
  }

  it("writes nothing when a ticket is collected with no work recorded", async () => {
    // The regression: pickup used to write a service row by itself, with a
    // default interval nobody confirmed. It must never write anything.
    const { db, shop, unit, ticket } = await benchTicket("regulator", "Reg #10");
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      status: "in_progress",
    });
    await setWorkOrderStatus(db, { shopId: shop.id, workOrderId: ticket.id, status: "picked_up" });
    expect(await serviceEvents(db, unit.id)).toEqual([]);
    expect((await unitStatus(db, unit.id))?.status).toBe("needs_service");

    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const theirs = await customerTicket(db, shop.id, maya.id, piece.id);
    await setWorkOrderStatus(db, { shopId: shop.id, workOrderId: theirs.id, status: "picked_up" });
    const [after] = await db
      .select()
      .from(customerGearItems)
      .where(eq(customerGearItems.id, piece.id));
    expect(after?.serviceDueOn).toBeNull();
  });

  it("writes a passed service through the register, with the dates and dives confirmed", async () => {
    const { db, shop, unit, ticket } = await benchTicket("regulator", "Reg #11");
    const tech = await staff(db, shop.id, "Theo Bench");
    const recorded = await recordWorkOrderWork(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      outcome: "done",
      care: [
        {
          kind: "service",
          passed: true,
          performedOn: "2026-10-06",
          nextDueOn: "2027-04-06",
          nextDueDives: 100,
        },
      ],
      todayLocal: TODAY,
      actorPersonId: tech.id,
    });
    expect(recorded.ok).toBe(true);
    const clocks = await latestServiceClocks(db, shop.id, [unit.id]);
    const clock = clocks.get(unit.id)?.find((entry) => entry.kind === "service");
    expect(clock?.servicedOn).toBe("2026-10-06");
    expect(clock?.nextDueOn).toBe("2027-04-06");
    expect(clock?.nextDueDives).toBe(100);
    // Back on the wall, through the register's own returnToService.
    expect(await unitStatus(db, unit.id)).toEqual({ status: "in_service", serviceNote: null });
    const detail = await getGearItemDetail(db, shop.id, unit.id);
    expect(detail?.history.some((event) => event.servicedOn === "2026-10-06")).toBe(true);
  });

  it("writes no clock for a failed check, and keeps the cylinder off the wall", async () => {
    const { db, shop, unit, ticket } = await benchTicket("tank", "AL80-07");
    const recorded = await recordWorkOrderWork(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      outcome: "done",
      care: [
        { kind: "visual_inspection", passed: true, performedOn: TODAY, nextDueOn: "2027-10-08" },
        { kind: "hydro_test", passed: false, performedOn: TODAY },
      ],
      todayLocal: TODAY,
    });
    expect(recorded.ok).toBe(true);
    const kinds = (await serviceEvents(db, unit.id)).map((event) => event.kind);
    // The passed inspection is on the record; the failed hydro must never read
    // as a fresh one.
    expect(kinds).toEqual(["visual_inspection"]);
    expect((await unitStatus(db, unit.id))?.status).toBe("needs_service");
  });

  it("leaves the open service concern standing when the job is declined", async () => {
    const { db, shop, unit, ticket } = await benchTicket("regulator", "Reg #12");
    const maya = await diver(db, shop.id, "Maya Pressure");
    // The unit came home from a rental with a concern a packer must see.
    await db.insert(gearReservations).values({
      shopId: shop.id,
      gearItemId: unit.id,
      personId: maya.id,
      reservedFrom: "2026-10-01",
      reservedUntil: "2026-10-02",
      checkedOutAt: new Date("2026-10-01T08:00:00Z"),
      returnedAt: new Date("2026-10-02T18:00:00Z"),
      returnOutcome: "service_concern",
      returnNote: "Second stage free-flows",
    });
    expect(
      (await openServiceConcerns(db, shop.id, [{ id: unit.id, kind: unit.kind }])).has(unit.id),
    ).toBe(true);

    const recorded = await recordWorkOrderWork(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      outcome: "declined",
      care: [],
      todayLocal: TODAY,
    });
    expect(recorded.ok).toBe(true);
    await setWorkOrderStatus(db, { shopId: shop.id, workOrderId: ticket.id, status: "picked_up" });

    expect(await serviceEvents(db, unit.id)).toEqual([]);
    expect(
      (await openServiceConcerns(db, shop.id, [{ id: unit.id, kind: unit.kind }])).has(unit.id),
    ).toBe(true);
    expect((await unitStatus(db, unit.id))?.status).toBe("needs_service");
  });

  it("keeps a condemned unit off the wall, saying why", async () => {
    const { db, shop, unit, ticket } = await benchTicket("tank", "AL80-08");
    expect(
      await recordWorkOrderWork(db, {
        shopId: shop.id,
        workOrderId: ticket.id,
        outcome: "condemned",
        care: [],
        todayLocal: TODAY,
      }),
    ).toEqual({ ok: false, reason: "note_required" });
    const recorded = await recordWorkOrderWork(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      outcome: "condemned",
      outcomeNote: "Failed hydro: permanent expansion over limit",
      care: [],
      todayLocal: TODAY,
    });
    expect(recorded.ok).toBe(true);
    expect(await unitStatus(db, unit.id)).toEqual({
      status: "needs_service",
      serviceNote: "Failed hydro: permanent expansion over limit",
    });
    expect(await serviceEvents(db, unit.id)).toEqual([]);
  });

  it("refuses care on a job not done, a done job with no care, and a care the gear has not got", async () => {
    const { db, shop, ticket } = await benchTicket("regulator", "Reg #13");
    const record = (input: Partial<Parameters<typeof recordWorkOrderWork>[1]>) =>
      recordWorkOrderWork(db, {
        shopId: shop.id,
        workOrderId: ticket.id,
        outcome: "done",
        care: [],
        todayLocal: TODAY,
        ...input,
      });
    expect(await record({})).toEqual({ ok: false, reason: "no_care" });
    expect(
      await record({
        outcome: "declined",
        care: [{ kind: "service", passed: true, performedOn: TODAY }],
      }),
    ).toEqual({ ok: false, reason: "care_on_not_done" });
    // A regulator has no hydro test.
    expect(
      await record({ care: [{ kind: "hydro_test", passed: true, performedOn: TODAY }] }),
    ).toEqual({ ok: false, reason: "invalid_care" });
    expect(
      await record({ care: [{ kind: "service", passed: true, performedOn: "2026-10-09" }] }),
    ).toEqual({ ok: false, reason: "future_date" });
    expect(
      await record({
        care: [{ kind: "service", passed: true, performedOn: TODAY, nextDueOn: TODAY }],
      }),
    ).toEqual({ ok: false, reason: "due_not_after_performed" });
    // A failed check carries no next date: it did not earn one.
    expect(
      await record({
        care: [{ kind: "service", passed: false, performedOn: TODAY, nextDueOn: "2027-10-08" }],
      }),
    ).toEqual({ ok: false, reason: "invalid_care" });
    expect(
      await db.select().from(workOrderCare).where(eq(workOrderCare.workOrderId, ticket.id)),
    ).toEqual([]);
  });

  it("is recorded once, and never on a collected ticket", async () => {
    const { db, shop, ticket } = await benchTicket("regulator", "Reg #14");
    const once = () =>
      recordWorkOrderWork(db, {
        shopId: shop.id,
        workOrderId: ticket.id,
        outcome: "declined",
        care: [],
        todayLocal: TODAY,
      });
    expect((await once()).ok).toBe(true);
    expect(await once()).toEqual({ ok: false, reason: "already_recorded" });

    const second = await createWorkOrder(db, {
      shopId: shop.id,
      gearItemId: ticket.gearItemId ?? undefined,
      reportedProblem: "Again",
    });
    if (!second.ok) throw new Error("ticket refused");
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: second.workOrder.id,
      status: "picked_up",
    });
    expect(
      await recordWorkOrderWork(db, {
        shopId: shop.id,
        workOrderId: second.workOrder.id,
        outcome: "declined",
        care: [],
        todayLocal: TODAY,
      }),
    ).toEqual({ ok: false, reason: "closed" });
  });

  it("sets a customer's dates from the day the work was performed, over a date staff set", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    await updateCustomerGearItem(db, {
      shopId: shop.id,
      customerGearItemId: piece.id,
      kind: "regulator",
      serviceDueOn: "2028-01-01",
    });
    const tank = await addCustomerGearItem(db, {
      shopId: shop.id,
      personId: maya.id,
      kind: "tank",
      hydroDueOn: "2027-05-01",
    });
    if (!tank.ok) throw new Error("tank refused");
    const opened = await createWorkOrder(db, {
      shopId: shop.id,
      personId: maya.id,
      customerGearItemIds: [piece.id, tank.item.id],
      reportedProblem: "Annual",
    });
    if (!opened.ok) throw new Error("ticket refused");

    const recorded = await recordWorkOrderWork(db, {
      shopId: shop.id,
      workOrderId: opened.workOrder.id,
      outcome: "done",
      care: [
        {
          customerGearItemId: piece.id,
          kind: "service",
          passed: true,
          performedOn: "2026-09-20",
          nextDueOn: "2027-09-20",
        },
        {
          customerGearItemId: tank.item.id,
          kind: "visual_inspection",
          passed: true,
          performedOn: "2026-09-21",
          nextDueOn: "2027-09-21",
        },
        { customerGearItemId: tank.item.id, kind: "hydro_test", passed: false, performedOn: TODAY },
      ],
      todayLocal: TODAY,
    });
    expect(recorded.ok).toBe(true);
    const pieces = await listCustomerGearItems(db, shop.id, maya.id);
    const reg = pieces.find((row) => row.id === piece.id);
    const cylinder = pieces.find((row) => row.id === tank.item.id);
    // The recorded service is newer than any date typed before it.
    expect(reg?.serviceDueOn).toBe("2027-09-20");
    expect(cylinder?.inspectionDueOn).toBe("2027-09-21");
    // A failed hydro leaves the hydro date exactly as it was.
    expect(cylinder?.hydroDueOn).toBe("2027-05-01");
    expect(cylinder?.serviceDueOn).toBeNull();

    // Collecting it afterwards changes nothing.
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: opened.workOrder.id,
      status: "picked_up",
    });
    const again = await listCustomerGearItems(db, shop.id, maya.id);
    expect(again.find((row) => row.id === piece.id)?.serviceDueOn).toBe("2027-09-20");
  });

  it("keeps a date staff set when no work was recorded", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    await updateCustomerGearItem(db, {
      shopId: shop.id,
      customerGearItemId: piece.id,
      kind: "regulator",
      serviceDueOn: "2028-01-01",
    });
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    await recordWorkOrderWork(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      outcome: "declined",
      care: [],
      todayLocal: TODAY,
    });
    const [after] = await listCustomerGearItems(db, shop.id, maya.id);
    expect(after?.serviceDueOn).toBe("2028-01-01");
  });

  it("refuses care on a piece that is not on the ticket", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const other = await customerPiece(db, shop.id, maya.id, "bcd");
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    expect(
      await recordWorkOrderWork(db, {
        shopId: shop.id,
        workOrderId: ticket.id,
        outcome: "done",
        care: [{ customerGearItemId: other.id, kind: "service", passed: true, performedOn: TODAY }],
        todayLocal: TODAY,
      }),
    ).toEqual({ ok: false, reason: "invalid_care" });
  });
});

describe("a shop unit on the bench", () => {
  it("goes back to what it was when its ticket is deleted, and off again on restore", async () => {
    const { db, shop } = await workOrderShopContext();
    const unit = await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #20" });
    if (!unit.ok) throw new Error("unit insert failed");
    const opened = await createWorkOrder(db, {
      shopId: shop.id,
      gearItemId: unit.item.id,
      reportedProblem: "Inflator sticks",
    });
    if (!opened.ok) throw new Error("ticket refused");
    expect((await unitStatus(db, unit.item.id))?.status).toBe("needs_service");

    await deleteWorkOrder(db, { shopId: shop.id, workOrderId: opened.workOrder.id });
    expect(await unitStatus(db, unit.item.id)).toEqual({ status: "in_service", serviceNote: null });

    await restoreWorkOrder(db, { shopId: shop.id, workOrderId: opened.workOrder.id });
    expect(await unitStatus(db, unit.item.id)).toEqual({
      status: "needs_service",
      serviceNote: "Inflator sticks",
    });
  });

  it("keeps a unit off the wall when another ticket still holds it", async () => {
    const { db, shop } = await workOrderShopContext();
    const unit = await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #21" });
    if (!unit.ok) throw new Error("unit insert failed");
    const first = await createWorkOrder(db, {
      shopId: shop.id,
      gearItemId: unit.item.id,
      reportedProblem: "Inflator sticks",
    });
    const second = await createWorkOrder(db, {
      shopId: shop.id,
      gearItemId: unit.item.id,
      reportedProblem: "Dump valve leaks",
    });
    if (!first.ok || !second.ok) throw new Error("ticket refused");
    // Deleting the newer ticket puts back what it found: the first ticket's hold.
    await deleteWorkOrder(db, { shopId: shop.id, workOrderId: second.workOrder.id });
    expect(await unitStatus(db, unit.item.id)).toEqual({
      status: "needs_service",
      serviceNote: "Inflator sticks",
    });
  });

  it("leaves a unit alone on delete once work was recorded on the ticket", async () => {
    const { db, shop } = await workOrderShopContext();
    const unit = await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #22" });
    if (!unit.ok) throw new Error("unit insert failed");
    const opened = await createWorkOrder(db, {
      shopId: shop.id,
      gearItemId: unit.item.id,
      reportedProblem: "Hard breathing",
    });
    if (!opened.ok) throw new Error("ticket refused");
    await recordWorkOrderWork(db, {
      shopId: shop.id,
      workOrderId: opened.workOrder.id,
      outcome: "condemned",
      outcomeNote: "First stage body cracked",
      care: [],
      todayLocal: TODAY,
    });
    await deleteWorkOrder(db, { shopId: shop.id, workOrderId: opened.workOrder.id });
    expect(await unitStatus(db, unit.item.id)).toEqual({
      status: "needs_service",
      serviceNote: "First stage body cracked",
    });
  });
});

describe("erasing a diver with tickets", () => {
  it("redacts the words on their lines and the outcome note, keeping kinds and amounts", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    await addWorkOrderLine(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      kind: "labor",
      description: "Rebuilt Maya's own second stage",
      quantityHundredths: 150,
      unitAmountCents: 6000,
    });
    await recordWorkOrderWork(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      outcome: "unserviceable",
      outcomeNote: "Maya says it was dropped",
      care: [],
      todayLocal: TODAY,
    });
    await erased(db, shop.id, maya.id);

    const [line] = await db
      .select()
      .from(workOrderLines)
      .where(eq(workOrderLines.workOrderId, ticket.id));
    expect(line?.description).not.toContain("Maya");
    expect(line?.kind).toBe("labor");
    expect(line?.quantityHundredths).toBe(150);
    expect(line?.unitAmountCents).toBe(6000);
    const [order] = await db.select().from(workOrders).where(eq(workOrders.id, ticket.id));
    expect(order?.outcomeNote).toBeNull();
  });
});

describe("parts and labor", () => {
  it("adds, corrects and deletes lines, and totals what is left", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);

    const part = await addWorkOrderLine(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      kind: "part",
      description: "Service kit",
      quantityHundredths: 100,
      unitAmountCents: 4500,
    });
    const labor = await addWorkOrderLine(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      kind: "labor",
      description: "Bench time",
      quantityHundredths: 150,
      unitAmountCents: 8000,
    });
    if (!part.ok || !labor.ok) throw new Error("line refused");

    let detail = await getWorkOrderDetail(db, shop.id, ticket.id, { todayLocal: TODAY });
    expect(detail?.totalCents).toBe(4500 + 12000);

    await updateWorkOrderLine(db, {
      shopId: shop.id,
      workOrderLineId: labor.line.id,
      kind: "labor",
      description: "Bench time",
      quantityHundredths: 100,
      unitAmountCents: 8000,
    });
    detail = await getWorkOrderDetail(db, shop.id, ticket.id, { todayLocal: TODAY });
    expect(detail?.totalCents).toBe(4500 + 8000);

    expect(
      (await deleteWorkOrderLine(db, { shopId: shop.id, workOrderLineId: part.line.id })).ok,
    ).toBe(true);
    detail = await getWorkOrderDetail(db, shop.id, ticket.id, { todayLocal: TODAY });
    expect(detail?.lines.map((line) => line.id)).toEqual([labor.line.id]);
    expect(detail?.totalCents).toBe(8000);
  });

  it("refuses an empty description, a zero quantity and a silly amount", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    const base = {
      shopId: shop.id,
      workOrderId: ticket.id,
      kind: "part" as const,
      description: "Kit",
      quantityHundredths: 100,
      unitAmountCents: 100,
    };
    expect(await addWorkOrderLine(db, { ...base, description: " " })).toEqual({
      ok: false,
      reason: "empty_description",
    });
    expect(await addWorkOrderLine(db, { ...base, quantityHundredths: 0 })).toEqual({
      ok: false,
      reason: "invalid_quantity",
    });
    expect(await addWorkOrderLine(db, { ...base, unitAmountCents: -1 })).toEqual({
      ok: false,
      reason: "invalid_amount",
    });
    expect(await addWorkOrderLine(db, { ...base, unitAmountCents: 10_000_000 })).toEqual({
      ok: false,
      reason: "invalid_amount",
    });
  });

  it("carries a warranty part at no charge", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    expect(
      (
        await addWorkOrderLine(db, {
          shopId: shop.id,
          workOrderId: ticket.id,
          kind: "part",
          description: "Warranty diaphragm",
          quantityHundredths: 100,
          unitAmountCents: 0,
        })
      ).ok,
    ).toBe(true);
  });

  it("refuses a line on another shop's ticket", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-work-orders-4", timezone: "America/New_York" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    expect(
      await addWorkOrderLine(db, {
        shopId: rival.id,
        workOrderId: ticket.id,
        kind: "part",
        description: "Kit",
        quantityHundredths: 100,
        unitAmountCents: 100,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("the board", () => {
  it("groups open tickets by status in counter order, with the collected last", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const pieces = await Promise.all([
      customerPiece(db, shop.id, maya.id),
      customerPiece(db, shop.id, maya.id, "bcd"),
      customerPiece(db, shop.id, maya.id, "wetsuit"),
    ]);
    const tickets = [];
    for (const piece of pieces) tickets.push(await customerTicket(db, shop.id, maya.id, piece.id));
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: tickets[1].id,
      status: "ready",
    });
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: tickets[2].id,
      status: "picked_up",
    });

    const board = await workOrderBoard(db, shop.id, { todayLocal: TODAY });
    expect(board.groups.map((group) => group.status)).toEqual(["received", "ready", "picked_up"]);
    expect(board.openCount).toBe(2);
    expect(board.groups[0].rows[0].personName).toBe("Maya Pressure");
    expect(board.groups[0].rows[0].pieceCount).toBe(1);
  });

  it("marks a ticket late once its promised day has gone", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const opened = await createWorkOrder(db, {
      shopId: shop.id,
      personId: maya.id,
      customerGearItemIds: [piece.id],
      reportedProblem: "Free-flows",
      promisedOn: "2026-10-01",
    });
    if (!opened.ok) throw new Error("ticket refused");
    const board = await workOrderBoard(db, shop.id, { todayLocal: TODAY });
    expect(board.groups[0].rows[0].late).toBe(true);
  });

  it("carries each row's total in the shop's own currency minor unit", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    await addWorkOrderLine(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      kind: "labor",
      description: "Bench time",
      quantityHundredths: 150,
      unitAmountCents: 8000,
    });
    const board = await workOrderBoard(db, shop.id, { todayLocal: TODAY });
    expect(board.groups[0].rows[0].totalCents).toBe(12000);
  });

  it("counts live tickets for the nav, and leaves a deleted one out", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    expect(await countWorkOrders(db, shop.id)).toBe(1);

    expect((await deleteWorkOrder(db, { shopId: shop.id, workOrderId: ticket.id })).ok).toBe(true);
    expect(await countWorkOrders(db, shop.id)).toBe(0);
    const board = await workOrderBoard(db, shop.id, { todayLocal: TODAY });
    expect(board.groups).toEqual([]);
    expect((await listDeletedWorkOrders(db, shop.id)).map((row) => row.id)).toEqual([ticket.id]);
  });

  it("keeps a deleted ticket's own record readable, with the way back", async () => {
    // The shop may still be asked what happened to that regulator (ADR
    // 20260823's rule for a soft-deleted record page).
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    await deleteWorkOrder(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      deletedByPersonId: maya.id,
    });

    const detail = await getWorkOrderDetail(db, shop.id, ticket.id, { todayLocal: TODAY });
    expect(detail?.workOrder.deletedAt).not.toBeNull();
    expect(detail?.workOrder.deletedByPersonId).toBe(maya.id);
    // And every writer refuses it while it is deleted.
    expect(
      await setWorkOrderStatus(db, {
        shopId: shop.id,
        workOrderId: ticket.id,
        status: "ready",
      }),
    ).toEqual({ ok: false, reason: "not_found" });

    expect((await restoreWorkOrder(db, { shopId: shop.id, workOrderId: ticket.id })).ok).toBe(true);
    expect(await countWorkOrders(db, shop.id)).toBe(1);
  });

  it("lists a diver's own tickets on their record", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const sam = await diver(db, shop.id, "Sam Surface");
    const mine = await customerPiece(db, shop.id, maya.id);
    const theirs = await customerPiece(db, shop.id, sam.id);
    const ticket = await customerTicket(db, shop.id, maya.id, mine.id);
    await customerTicket(db, shop.id, sam.id, theirs.id);

    const rows = await listWorkOrdersForPerson(db, shop.id, maya.id, { todayLocal: TODAY });
    expect(rows.map((row) => row.id)).toEqual([ticket.id]);
  });

  it("keeps one shop's board out of another's", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    await customerTicket(db, shop.id, maya.id, piece.id);
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-work-orders-5", timezone: "America/New_York" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    expect((await workOrderBoard(db, rival.id, { todayLocal: TODAY })).groups).toEqual([]);
    expect(await countWorkOrders(db, rival.id)).toBe(0);
    expect(await listWorkOrdersForPerson(db, rival.id, maya.id, { todayLocal: TODAY })).toEqual([]);
  });

  it("writes every row with the shop that owns it", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    await addWorkOrderLine(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      kind: "part",
      description: "Kit",
      quantityHundredths: 100,
      unitAmountCents: 100,
    });
    const rows = await db
      .select()
      .from(workOrders)
      .where(and(eq(workOrders.id, ticket.id), eq(workOrders.shopId, shop.id)));
    expect(rows).toHaveLength(1);
    const detail = await getWorkOrderDetail(db, shop.id, ticket.id, { todayLocal: TODAY });
    expect(detail?.lines.every((line) => line.shopId === shop.id)).toBe(true);
    expect(detail?.events.every((event) => event.shopId === shop.id)).toBe(true);
  });
});
