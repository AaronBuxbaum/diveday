import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { bookings, heldSends, people, personRoles, trips } from "@/db/schema";
import { nowMs } from "@/lib/clock";
import { SEND_HOLD_MS } from "@/lib/held-sends";
import { seededShopContext } from "@/test/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { revalidatePath } = await import("next/cache");
const { holdSendAction, releaseHeldSendAction, undoHeldSendAction } = await import("./held-sends");

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const staff = await db
    .select({ personId: personRoles.personId, role: personRoles.role })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(eq(people.shopId, shop.id));
  const owner = staff.find((row) => row.role === "owner");
  const captain = staff.find((row) => row.role === "captain");
  const [seat] = await db
    .select({ bookingId: bookings.id, tripId: trips.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(bookings.shopId, shop.id), eq(bookings.status, "booked")))
    .limit(1);
  if (!owner || !captain || !seat) throw new Error("fixture needs an owner, a captain and a seat");
  return { db, shop, owner, captain, seat };
}

function signIn(shop: { id: string }, person: { personId: string; role: string }) {
  vi.mocked(requireStaffSession).mockResolvedValue({
    user: { shopId: shop.id, personId: person.personId, roles: [person.role] },
  } as never);
}

function dealForm(tripId: string, recipient: string): FormData {
  const form = new FormData();
  form.set("holdKind", "last_minute_deal");
  form.set("tripId", tripId);
  form.set("discountPercent", "25");
  form.append("recipientPersonIds", recipient);
  return form;
}

async function heldRows(db: AppDb, shopId: string) {
  return db.select().from(heldSends).where(eq(heldSends.shopId, shopId));
}

/**
 * ADR 20260906-before-you-ask, decision 2. Discounting is money work wherever
 * the button sits (issue #714): the gate the immediate deal action carried
 * moved here with the send, and a captain is refused before a row is written.
 */
describe("holdSendAction", () => {
  it("refuses a captain the last-minute deal blast", async () => {
    const { db, shop, captain, seat } = await context();
    signIn(shop, captain);
    await expect(holdSendAction(dealForm(seat.tripId, captain.personId))).rejects.toThrow(
      "not_authorized",
    );
    expect(await heldRows(db, shop.id)).toEqual([]);
  });

  it("holds an owner's deal eight seconds, with ids only in the row", async () => {
    const { db, shop, owner, seat } = await context();
    signIn(shop, owner);
    const ticket = await holdSendAction(dealForm(seat.tripId, owner.personId));
    // Against the clock, which the suite freezes (`src/lib/clock.ts`).
    expect(ticket.runAt - nowMs()).toBe(SEND_HOLD_MS);
    const [row] = await heldRows(db, shop.id);
    expect(row?.payload).toEqual({
      kind: "last_minute_deal",
      tripId: seat.tripId,
      discountPercent: 25,
      recipientPersonIds: [owner.personId],
    });
    expect(row?.actorPersonId).toBe(owner.personId);
  });

  it("holds a fixed-amount deal in minor units, typed in whole currency units", async () => {
    const { db, shop, owner, seat } = await context();
    signIn(shop, owner);
    const form = dealForm(seat.tripId, owner.personId);
    form.delete("discountPercent");
    form.set("discount", "20");
    form.set("discountKind", "amount");
    await holdSendAction(form);
    const [row] = await heldRows(db, shop.id);
    expect(row?.payload).toEqual({
      kind: "last_minute_deal",
      tripId: seat.tripId,
      discountAmountCents: 2_000,
      recipientPersonIds: [owner.personId],
    });
  });

  it("holds a waiver send from the surface's own hidden inputs, and Undo takes it back", async () => {
    const { db, shop, captain, seat } = await context();
    signIn(shop, captain);
    const form = new FormData();
    form.set("holdKind", "waiver_send");
    form.set("surface", "roster");
    form.set("tripId", seat.tripId);
    form.append("bookingId", seat.bookingId);
    const ticket = await holdSendAction(form);
    const [row] = await heldRows(db, shop.id);
    expect(row?.payload).toEqual({
      kind: "waiver_send",
      bookingIds: [seat.bookingId],
      channel: "email",
      surface: "roster",
      tripId: seat.tripId,
    });
    expect(await undoHeldSendAction(ticket.id)).toBe(true);
    expect(await heldRows(db, shop.id)).toEqual([]);
  });

  // Issue #2346: a rental ticket's send is its own surface, carries the
  // ticket, and its release refreshes that ticket rather than the diver record.
  it("holds a counter rental's waiver send with its ticket, and refreshes that ticket", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const [walkIn] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Counter Walk-In" })
      .returning();
    if (!walkIn) throw new Error("person insert failed");
    const ticketId = "6f3c2a10-1b2c-4d3e-8f4a-5b6c7d8e9f00";
    const form = new FormData();
    form.set("holdKind", "waiver_send");
    form.set("surface", "counter");
    form.set("ticketId", ticketId);
    form.set("personId", walkIn.id);
    const ticket = await holdSendAction(form);
    const [row] = await heldRows(db, shop.id);
    expect(row?.payload).toEqual({
      kind: "waiver_send",
      bookingIds: [],
      personId: walkIn.id,
      channel: "email",
      surface: "counter",
      ticketId,
    });

    vi.mocked(revalidatePath).mockClear();
    expect((await releaseHeldSendAction(ticket.id)).status).toBe("done");
    expect(revalidatePath).toHaveBeenCalledWith(`/shop/${shop.slug}/gear/rentals/${ticketId}`);
  });

  it("refuses a form that names no send at all", async () => {
    const { shop, owner } = await context();
    signIn(shop, owner);
    const form = new FormData();
    form.set("holdKind", "waiver_send");
    form.set("surface", "roster");
    await expect(holdSendAction(form)).rejects.toThrow();
  });
});
