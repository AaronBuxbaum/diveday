import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { bookings, orders } from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { hrefsIn } from "@/test/jsx-inspect";
import { orderIndexFilter, ordersIndexHref } from "../order-index-filter";
import { OrdersSeatLines } from "./OrdersSeatLines";

const ctx = fileScopedShopContext();
const t = staffTranslator("en-US");

/** The nodes' text, joined. */
function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: unknown } }).props.children);
  }
  return "";
}

async function departureWithAnOpenOrder(cancelSeat: boolean) {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (candidate) => candidate.booked > 0 && candidate.title.startsWith("Two-Tank Reef"),
  );
  if (!trip) throw new Error("seeded reef trip missing");
  const [booking] = await db
    .select({ id: bookings.id, personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.tripId, trip.id))
    .limit(1);
  if (!booking) throw new Error("seeded reef trip has no bookings");
  await db.insert(orders).values({
    shopId: shop.id,
    bookingId: booking.id,
    personId: booking.personId,
    createdByPersonId: booking.personId,
    status: "open",
    currency: "usd",
    totalCents: 12_000,
    amountPaidCents: 0,
    description: "Balance",
    stripeAccountId: "acct_test",
    stripeCustomerId: "cus_seat_lines",
    stripeInvoiceId: "in_seat_lines",
    createdAt: nowDate(),
    updatedAt: nowDate(),
  });
  if (cancelSeat) {
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
  }
  return { db, shopId: shop.id, tripId: trip.id };
}

const hrefFor = (seats: "live" | "cancelled") => `/orders?seats=${seats}`;

describe("OrdersSeatLines", () => {
  it("links the live view to the orders left on canceled seats", async () => {
    const { db, shopId, tripId } = await departureWithAnOpenOrder(true);
    const element = await OrdersSeatLines({
      db,
      shopId,
      filter: { tripId, status: "open", seats: "live" },
      seats: "live",
      hrefFor,
      t,
    });
    expect(textOf(element)).toContain("1 more order is on canceled seats");
    expect(hrefsIn(element)).toEqual(["/orders?seats=cancelled"]);
  });

  it("says the canceled view is canceled seats only, with the way back and the live count", async () => {
    const { db, shopId, tripId } = await departureWithAnOpenOrder(false);
    const element = await OrdersSeatLines({
      db,
      shopId,
      filter: { tripId, status: "open", seats: "cancelled" },
      seats: "cancelled",
      hrefFor,
      t,
    });
    expect(textOf(element)).toContain("Showing the orders left on canceled seats");
    expect(textOf(element)).toContain("1 order is on seats still on the boat");
    expect(hrefsIn(element)).toEqual(["/orders?seats=live", "/orders?seats=live"]);
  });

  it("draws no line when no order sits on the other half, or when no departure is filtered", async () => {
    const { db, shopId, tripId } = await departureWithAnOpenOrder(false);
    const none = await OrdersSeatLines({
      db,
      shopId,
      filter: { tripId, status: "open", seats: "live" },
      seats: "live",
      hrefFor,
      t,
    });
    expect(textOf(none)).toBe("");
    expect(hrefsIn(none)).toEqual([]);
    expect(
      await OrdersSeatLines({ db, shopId, filter: {}, seats: undefined, hrefFor, t }),
    ).toBeNull();
  });
});

describe("the Orders index's reading of ?seats=", () => {
  const read = (params: Parameters<typeof orderIndexFilter>[0]) =>
    orderIndexFilter(params, "UTC", new Date("2026-10-15T12:00:00Z")).filter.seats;
  const TRIP = "5b0d7a6e-4a53-4c3e-9d61-0f6a8a0e1b11";

  it("reads a departure's live seats unless the canceled ones are asked for by name", () => {
    expect(read({ tripId: TRIP })).toBe("live");
    expect(read({ tripId: TRIP, seats: "live" })).toBe("live");
    expect(read({ tripId: TRIP, seats: "cancelled" })).toBe("cancelled");
    expect(read({ tripId: TRIP, seats: "everything" })).toBe("live");
  });

  it("ignores ?seats= with no departure, and with a malformed one", () => {
    expect(read({ seats: "cancelled" })).toBeUndefined();
    expect(read({ tripId: "nope", seats: "cancelled" })).toBeUndefined();
  });
});

describe("ordersIndexHref", () => {
  it("keeps the filters, and carries the canceled seats only when they are the view", () => {
    const view = { status: "open", tripId: "t-1", range: "all", seats: "cancelled" as const };
    expect(ordersIndexHref("blue-mantis", view, {})).toBe(
      "/shop/blue-mantis/orders?status=open&tripId=t-1&seats=cancelled&range=all",
    );
    expect(ordersIndexHref("blue-mantis", view, { seats: "live" })).toBe(
      "/shop/blue-mantis/orders?status=open&tripId=t-1&range=all",
    );
    expect(ordersIndexHref("blue-mantis", view, { page: 3 }, "orders/download")).toContain(
      "/orders/download?",
    );
  });

  it("keeps only the ranges the page names", () => {
    expect(ordersIndexHref("s", { range: "bogus" }, {})).toBe("/shop/s/orders");
    expect(ordersIndexHref("s", { range: "recent" }, { range: null })).toBe("/shop/s/orders");
    expect(ordersIndexHref("s", {}, { page: 1 })).toBe("/shop/s/orders");
  });
});
