import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { createDiver } from "./divers";
import { createGearItem, getGearItemDetail, latestServiceClocks } from "./gear";
import { customerGearItems, gearServiceEvents, shops, workOrders } from "./schema";
import {
  addCustomerGearItem,
  addWorkOrderLine,
  assignWorkOrderTechnician,
  countWorkOrders,
  createWorkOrder,
  deleteCustomerGearItem,
  deleteWorkOrder,
  deleteWorkOrderLine,
  getWorkOrderDetail,
  listCustomerGearItems,
  listDeletedWorkOrders,
  listWorkOrdersForPerson,
  restoreCustomerGearItem,
  restoreWorkOrder,
  saveWorkOrderDetails,
  saveWorkOrderNotes,
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
      todayLocal: TODAY,
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
            todayLocal: TODAY,
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
      todayLocal: TODAY,
    });
    if (!first.ok) throw new Error("move refused");
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      status: "in_progress",
      todayLocal: TODAY,
    });
    const again = await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      status: "ready",
      todayLocal: TODAY,
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
        todayLocal: TODAY,
      }),
    ).toEqual({ ok: false, reason: "already" });
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      status: "picked_up",
      todayLocal: TODAY,
    });
    expect(
      await setWorkOrderStatus(db, {
        shopId: shop.id,
        workOrderId: ticket.id,
        status: "in_progress",
        todayLocal: TODAY,
      }),
    ).toEqual({ ok: false, reason: "closed" });
  });

  it("assigns and unassigns a technician, recording each hand-over", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const tech = await diver(db, shop.id, "Theo Bench");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);

    await assignWorkOrderTechnician(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      technicianPersonId: tech.id,
    });
    let detail = await getWorkOrderDetail(db, shop.id, ticket.id, { todayLocal: TODAY });
    expect(detail?.technicianName).toBe("Theo Bench");

    await assignWorkOrderTechnician(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      technicianPersonId: null,
    });
    detail = await getWorkOrderDetail(db, shop.id, ticket.id, { todayLocal: TODAY });
    expect(detail?.technicianName).toBeNull();
    expect(detail?.events.filter((event) => event.kind === "technician_assigned")).toHaveLength(2);
  });

  it("keeps bench notes and what the customer is told as two fields", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    await saveWorkOrderNotes(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      technicianNotes: "Seat worn, diaphragm fine",
      workPerformed: "Replaced the second-stage seat and retuned",
    });
    const detail = await getWorkOrderDetail(db, shop.id, ticket.id, { todayLocal: TODAY });
    expect(detail?.workOrder.technicianNotes).toBe("Seat worn, diaphragm fine");
    expect(detail?.workOrder.workPerformed).toBe("Replaced the second-stage seat and retuned");
  });

  it("edits what came in and when it was promised", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    expect(
      await saveWorkOrderDetails(db, {
        shopId: shop.id,
        workOrderId: ticket.id,
        reportedProblem: "   ",
      }),
    ).toEqual({ ok: false, reason: "empty_problem" });
    const saved = await saveWorkOrderDetails(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      reportedProblem: "Free-flows below 20 m",
      promisedOn: "2026-10-20",
    });
    expect(saved.ok && saved.workOrder.promisedOn).toBe("2026-10-20");
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
        todayLocal: TODAY,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await assignWorkOrderTechnician(db, {
        shopId: rival.id,
        workOrderId: ticket.id,
        technicianPersonId: maya.id,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await saveWorkOrderNotes(db, {
        shopId: rival.id,
        workOrderId: ticket.id,
        workPerformed: "nothing",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await getWorkOrderDetail(db, rival.id, ticket.id, { todayLocal: TODAY })).toBeNull();
  });
});

describe("the service clock a finished ticket moves", () => {
  it("writes the fleet unit's own service event, so the register's clock moves", async () => {
    const { db, shop } = await workOrderShopContext();
    const unit = await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #10" });
    if (!unit.ok) throw new Error("unit insert failed");
    const opened = await createWorkOrder(db, {
      shopId: shop.id,
      gearItemId: unit.item.id,
      reportedProblem: "Annual service",
    });
    if (!opened.ok) throw new Error("ticket refused");

    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: opened.workOrder.id,
      status: "picked_up",
      todayLocal: TODAY,
    });

    const clocks = await latestServiceClocks(db, shop.id, [unit.item.id]);
    const clock = clocks.get(unit.item.id)?.find((entry) => entry.kind === "service");
    expect(clock?.servicedOn).toBe(TODAY);
    expect(clock?.nextDueOn).toBe("2027-10-08");
    // And the unit's own record reads it, which is the whole point of reusing
    // the register's history rather than keeping a second one.
    const detail = await getGearItemDetail(db, shop.id, unit.item.id);
    expect(detail?.history.some((event) => event.servicedOn === TODAY)).toBe(true);
  });

  it("writes no service event for a unit that runs no clock", async () => {
    const { db, shop } = await workOrderShopContext();
    const unit = await createGearItem(db, { shopId: shop.id, kind: "wetsuit", label: "Suit #4" });
    if (!unit.ok) throw new Error("unit insert failed");
    const opened = await createWorkOrder(db, {
      shopId: shop.id,
      gearItemId: unit.item.id,
      reportedProblem: "Seam split",
    });
    if (!opened.ok) throw new Error("ticket refused");
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: opened.workOrder.id,
      status: "picked_up",
      todayLocal: TODAY,
    });
    const events = await db
      .select()
      .from(gearServiceEvents)
      .where(eq(gearServiceEvents.gearItemId, unit.item.id));
    expect(events).toEqual([]);
  });

  it("sets a customer piece's next-service date from the same interval", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      status: "picked_up",
      todayLocal: TODAY,
    });
    const [updated] = await listCustomerGearItems(db, shop.id, maya.id);
    expect(updated?.serviceDueOn).toBe("2027-10-08");
  });

  it("leaves a future date staff set alone", async () => {
    // Staff own the date; a finished ticket fills a blank or a lapsed one, and
    // never argues with a call somebody already made.
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id);
    await updateCustomerGearItem(db, {
      shopId: shop.id,
      customerGearItemId: piece.id,
      kind: "regulator",
      serviceDueOn: "2027-01-05",
    });
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      status: "picked_up",
      todayLocal: TODAY,
    });
    const [updated] = await listCustomerGearItems(db, shop.id, maya.id);
    expect(updated?.serviceDueOn).toBe("2027-01-05");
  });

  it("sets nothing for a piece that runs no clock", async () => {
    const { db, shop } = await workOrderShopContext();
    const maya = await diver(db, shop.id, "Maya Pressure");
    const piece = await customerPiece(db, shop.id, maya.id, "wetsuit");
    const ticket = await customerTicket(db, shop.id, maya.id, piece.id);
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: ticket.id,
      status: "picked_up",
      todayLocal: TODAY,
    });
    const [updated] = await listCustomerGearItems(db, shop.id, maya.id);
    expect(updated?.serviceDueOn).toBeNull();
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
      todayLocal: TODAY,
    });
    await setWorkOrderStatus(db, {
      shopId: shop.id,
      workOrderId: tickets[2].id,
      status: "picked_up",
      todayLocal: TODAY,
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
        todayLocal: TODAY,
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
