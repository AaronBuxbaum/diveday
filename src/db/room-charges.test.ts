import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { REDACTED_TEXT } from "@/lib/anonymization";
import { DAY_MS, nowDate } from "@/lib/clock";
import type { InvoicingProvider } from "@/lib/payments/invoicing";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { anonymizeDiver } from "./anonymize";
import { recordPaymentOnOpenOrder } from "./orders";
import { roomChargesByHotel } from "./room-charges";
import { orders, people } from "./schema";

const ctx = fileScopedShopContext();

/** Stripe agrees the invoice was paid at the counter; nothing else is reached. */
const invoicing = {
  async markInvoicePaidOutOfBand() {
    return { status: "paid" as const };
  },
} as unknown as InvoicingProvider;

describe("room charges (fifth-loop ideas, item 57)", () => {
  it("a room charge names its room, and the month's room charges add up per hotel", async () => {
    const { db, shop } = ctx;
    const staff = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const [guest] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Room Guest", email: "room-guest@example.com" })
      .returning();
    const open = async (totalCents: number, invoice: string) => {
      const [row] = await db
        .insert(orders)
        .values({
          shopId: shop.id,
          personId: guest.id,
          createdByPersonId: staff,
          currency: "usd",
          totalCents,
          stripeAccountId: "acct_room",
          stripeCustomerId: "cus_room",
          stripeInvoiceId: invoice,
        })
        .returning();
      return row;
    };
    const charge = (orderId: string, room: { number: string; hotel: string | null } | null) =>
      recordPaymentOnOpenOrder(
        db,
        { shopId: shop.id, orderId, actorPersonId: staff, collection: "room_charge", room },
        invoicing,
      );

    const first = await open(22_000, "in_room_1");
    // No room, no charge: the front desk could not bill it.
    expect((await charge(first.id, null)).ok).toBe(false);
    expect((await charge(first.id, { number: "412", hotel: "Reef Hotel" })).ok).toBe(true);
    const [row] = await db.select().from(orders).where(eq(orders.id, first.id));
    expect(row).toMatchObject({
      status: "paid",
      collection: "room_charge",
      roomNumber: "412",
      roomHotel: "Reef Hotel",
    });

    const second = await open(8_000, "in_room_2");
    expect((await charge(second.id, { number: "9", hotel: "Reef Hotel" })).ok).toBe(true);
    const third = await open(5_000, "in_room_3");
    expect((await charge(third.id, { number: "2", hotel: null })).ok).toBe(true);
    // A cash order is not the front desk's to bill.
    const cash = await open(3_000, "in_room_cash");
    await recordPaymentOnOpenOrder(
      db,
      { shopId: shop.id, orderId: cash.id, actorPersonId: staff, collection: "cash" },
      invoicing,
    );

    const now = nowDate();
    const totals = await roomChargesByHotel(
      db,
      shop.id,
      new Date(now.getTime() - DAY_MS),
      new Date(now.getTime() + DAY_MS),
    );
    expect(totals).toEqual([
      { hotel: "Reef Hotel", currency: "usd", totalCents: 30_000, orders: 2 },
      { hotel: null, currency: "usd", totalCents: 5_000, orders: 1 },
    ]);
    // Outside the month asked for, nothing.
    expect(
      await roomChargesByHotel(
        db,
        shop.id,
        new Date(now.getTime() - 3 * DAY_MS),
        new Date(now.getTime() - DAY_MS),
      ),
    ).toEqual([]);

    // Erasure takes the room, which placed the guest in it; the hotel and the
    // money stay, for the front desk's monthly bill.
    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: guest.id,
      actorPersonId: staff,
    });
    expect(erased.ok).toBe(true);
    const [after] = await db.select().from(orders).where(eq(orders.id, first.id));
    expect(after).toMatchObject({ roomNumber: REDACTED_TEXT, roomHotel: "Reef Hotel" });
    const [cashAfter] = await db.select().from(orders).where(eq(orders.id, cash.id));
    expect(cashAfter?.roomNumber).toBeNull();
  });
});
