import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import type { Notification } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { createDiver } from "./divers";
import { shops } from "./schema";
import { sendDueServiceReminders, sendWorkOrderReadyNotice } from "./work-order-follow-up";
import {
  addCustomerGearItem,
  createWorkOrder,
  saveWorkOrder,
  setWorkOrderStatus,
} from "./work-orders";

/**
 * **Gear servicing switched off** (the Features page): no ready message and no
 * service reminder goes out; the tickets and pieces are kept, and both go out
 * again once it is switched back on.
 */
const ctx = fileScopedShopContext();

async function readyTicketForAPieceDueSoon() {
  const { db } = ctx;
  const [shop] = await db
    .insert(shops)
    .values({ name: "Bench Divers", slug: "bench-switch", timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  const maya = await createDiver(db, {
    shopId: shop.id,
    fullName: "Maya Off",
    email: "maya-off@example.com",
  });
  if (!maya) throw new Error("diver insert failed");
  const piece = await addCustomerGearItem(db, {
    shopId: shop.id,
    personId: maya.id,
    kind: "regulator",
    brandModel: "Apeks XTX200",
    serviceDueOn: "2026-08-15",
    inspectionDueOn: "",
    hydroDueOn: "",
  });
  if (!piece.ok) throw new Error(`piece refused: ${piece.reason}`);
  // A second piece, off the bench, so the reminder pass has one to remind about.
  const due = await addCustomerGearItem(db, {
    shopId: shop.id,
    personId: maya.id,
    kind: "bcd",
    brandModel: "Hollis ST Elite",
    serviceDueOn: "2026-08-15",
    inspectionDueOn: "",
    hydroDueOn: "",
  });
  if (!due.ok) throw new Error(`piece refused: ${due.reason}`);
  const ticket = await createWorkOrder(db, {
    shopId: shop.id,
    personId: maya.id,
    customerGearItemIds: [piece.item.id],
    reportedProblem: "Free-flows at depth",
  });
  if (!ticket.ok) throw new Error(`ticket refused: ${ticket.reason}`);
  await saveWorkOrder(db, {
    shopId: shop.id,
    workOrderId: ticket.workOrder.id,
    reportedProblem: "Free-flows at depth",
    technicianPersonId: null,
    workPerformed: "Serviced both stages.",
  });
  const moved = await setWorkOrderStatus(db, {
    shopId: shop.id,
    workOrderId: ticket.workOrder.id,
    status: "ready",
  });
  if (!moved.ok) throw new Error(`move refused: ${moved.reason}`);
  return { db, shop, ticket: ticket.workOrder };
}

const toMaya = (sent: Notification[]) =>
  sent.filter((notification) => "to" in notification && notification.to === "maya-off@example.com");

describe("with gear servicing switched off", () => {
  it("sends neither the ready message nor a service reminder until it is on again", async () => {
    const { db, shop, ticket } = await readyTicketForAPieceDueSoon();
    const email = fakeEmail();
    const ready = () =>
      sendWorkOrderReadyNotice(
        db,
        { shopId: shop.id, workOrderId: ticket.id },
        { emailProvider: email.provider },
      );
    const reminders = () =>
      sendDueServiceReminders(db, {
        now: nowDate(),
        emailProvider: email.provider,
        smsProvider: fakeSms().provider,
        whatsAppProviders: new Map(),
        appOrigin: "https://diveday.test",
      });

    await db.update(shops).set({ workOrdersEnabled: false }).where(eq(shops.id, shop.id));
    expect(await ready()).toEqual({ ok: false, reason: "not_found" });
    await reminders();
    expect(toMaya(email.sent)).toEqual([]);

    await db.update(shops).set({ workOrdersEnabled: true }).where(eq(shops.id, shop.id));
    expect((await ready()).ok).toBe(true);
    await reminders();
    expect(toMaya(email.sent).map((sent) => sent.kind)).toEqual([
      "work_order_ready",
      "gear_service_due",
    ]);
  });
});
