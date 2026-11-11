import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { loadDiverExportBundleInput, loadShopExportBundleInput } from "../../db/export";
import { countShopOrders, getOrder, listShopOrders, pagedOrdersByDay } from "../../db/orders";
import {
  bookings,
  collectionEntries,
  divePackageEntitlements,
  gearReservations,
  integrationEvents,
  orders,
  people,
} from "../../db/schema";
import { fileScopedShopContext } from "../../test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "../../test/staff-session";
import {
  lend,
  rented,
  unit,
} from "../../test/substrate-fixtures/db/gear-counter-rentals-test-fixtures";
import { linkCounterRentalOrder } from "../gear-counter-rentals";
import { listOrderLinesForExport } from "../order-export/store";
import { recordPurchase, recordPurchaseRefund } from "./store";

const context = fileScopedShopContext();
it("keeps walk-in receipts in ledger and exports without creating a person or duplicate fee", async () => {
  const { db, shop } = context;
  const actor = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const before = await db.select({ n: count() }).from(people);
  const input = {
    shopId: shop.id,
    personId: null,
    createdByPersonId: actor,
    attemptId: randomUUID(),
    currency: "usd",
    collection: "cash" as const,
    taxCents: 700,
    tipCents: 300,
    description: "Walk-in test receipt",
    lineItems: [
      { kind: "merchandise" as const, description: "Shirt", quantity: 1, unitAmountCents: 11000 },
    ],
  };
  const sale = await recordPurchase(db, input);
  expect(sale.ok).toBe(true);
  if (!sale.ok) throw new Error("receipt refused");
  expect((await recordPurchase(db, input)).ok).toBe(true);
  expect(await db.select({ n: count() }).from(people)).toEqual(before);
  expect((await getOrder(db, shop.id, sale.order.id))?.person).toBeNull();
  expect(
    (await listShopOrders(db, shop.id, { q: "Walk-in test receipt" })).rows.map((r) => r.order.id),
  ).toContain(sale.order.id);
  expect(
    (await listOrderLinesForExport(db, shop.id, { q: "Walk-in test receipt" })).map(
      (r) => r.orderId,
    ),
  ).toContain(sale.order.id);
  expect(await countShopOrders(db, shop.id, { q: "Walk-in test receipt" })).toBe(1);
  const ledger = await pagedOrdersByDay(db, shop.id, shop.timezone, { q: "Walk-in test receipt" });
  expect(ledger.page.total).toBe(1);
  expect(ledger.groups[0]?.subtotals).toEqual([{ currency: "usd", cents: 11000 }]);
  const exported = (await loadShopExportBundleInput(db, shop.id))?.tables.find(
    (t) => t.file === "orders.csv",
  );
  const receiptRow = exported?.rows.find(
    (row) => row[exported.header.indexOf("id")] === sale.order.id,
  );
  if (!exported || !receiptRow) throw new Error("missing receipt export");
  expect(receiptRow?.[exported.header.indexOf("person_id")]).toBeNull();
  expect(receiptRow?.[exported.header.indexOf("person_name")]).toBeNull();
  const personal = (await loadDiverExportBundleInput(db, shop.id, actor))?.tables.find(
    (t) => t.file === "orders.csv",
  );
  expect(personal?.rows.some((row) => row[personal.header.indexOf("id")] === sale.order.id)).toBe(
    false,
  );
  const events = await db
    .select()
    .from(integrationEvents)
    .where(eq(integrationEvents.entityId, sale.order.id));
  expect(events).toHaveLength(1);
  expect(events[0]?.payload.customer).toBeNull();
  const refund = {
    shopId: shop.id,
    orderId: sale.order.id,
    actorPersonId: actor,
    attemptId: randomUUID(),
    currency: "usd",
    amountCents: 5500,
    expectedRefundedCents: 0,
    reason: "Returned shirt",
  };
  expect((await recordPurchaseRefund(db, refund)).ok).toBe(true);
  expect((await recordPurchaseRefund(db, refund)).ok).toBe(true);
  const lots = await db
    .select()
    .from(collectionEntries)
    .where(eq(collectionEntries.sourceId, sale.order.id));
  expect(lots.map((r) => r.amountCents)).toEqual([10000, -5000]);
});

it("refuses anonymous receipts from nonstaff, another shop, and missing rather than explicit null payer", async () => {
  const { db, shop } = context;
  const actor = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const input = {
    shopId: shop.id,
    personId: null,
    createdByPersonId: actor,
    attemptId: randomUUID(),
    currency: "usd",
    collection: "cash" as const,
    lineItems: [
      { kind: "merchandise" as const, description: "Shirt", quantity: 1, unitAmountCents: 2000 },
    ],
  };
  const entitlementsBefore = await db.select().from(divePackageEntitlements);
  expect((await recordPurchase(db, { ...input, createdByPersonId: randomUUID() })).ok).toBe(false);
  expect((await recordPurchase(db, { ...input, shopId: randomUUID() })).ok).toBe(false);
  expect((await recordPurchase(db, { ...input, personId: randomUUID() })).ok).toBe(false);
  expect(
    (
      await recordPurchase(db, {
        ...input,
        lineItems: [
          {
            kind: "dive_package" as const,
            packageId: randomUUID(),
            description: "Package",
            quantity: 1,
            unitAmountCents: 2000,
          },
        ],
      })
    ).ok,
  ).toBe(false);
  expect(await db.select().from(divePackageEntitlements)).toEqual(entitlementsBefore);
  // Runtime input need not have passed through TypeScript or the form parser.
  expect((await recordPurchase(db, { ...input, personId: undefined as unknown as null })).ok).toBe(
    false,
  );
});

it("keeps the database's anonymous allowance restricted to completed counter receipts", async () => {
  const { db, shop } = context;
  const actor = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const sale = await recordPurchase(db, {
    shopId: shop.id,
    personId: null,
    createdByPersonId: actor,
    attemptId: randomUUID(),
    currency: "usd",
    collection: "cash",
    lineItems: [{ kind: "merchandise", description: "Shirt", quantity: 1, unitAmountCents: 2000 }],
  });
  if (!sale.ok) throw new Error("receipt refused");
  const fins = await unit(db, shop.id, "Anonymous boundary fins", "fins");
  const rental = rented(await lend(db, shop.id, actor, [fins.id]));
  expect(
    await linkCounterRentalOrder(db, {
      shopId: shop.id,
      orderId: sale.order.id,
      reservationIds: rental.reservationIds,
    }),
  ).toBe(0);
  const [reservation] = await db
    .select()
    .from(gearReservations)
    .where(eq(gearReservations.id, rental.reservationIds[0] ?? ""));
  expect(reservation?.orderId).toBeNull();
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.shopId, shop.id))
    .limit(1);
  if (!booking) throw new Error("missing seeded booking");
  for (const patch of [
    { bookingId: booking.id },
    { counterReceipt: null },
    { status: "open" as const },
    { collection: "stripe_invoice" as const },
    { stripeInvoiceId: "in_forbidden" },
    { source: "public" as const },
  ]) {
    await expect(
      db.transaction(async (tx) => {
        await tx.update(orders).set(patch).where(eq(orders.id, sale.order.id));
      }),
    ).rejects.toThrow();
  }
  expect((await getOrder(db, shop.id, sale.order.id))?.order.personId).toBeNull();
});
