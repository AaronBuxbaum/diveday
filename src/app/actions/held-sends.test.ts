import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { bookings, heldSends, people, personRoles, trips } from "@/db/schema";
import { ALL_ROLES } from "@/lib/authz";
import { nowMs } from "@/lib/clock";
import { SEND_HOLD_MS } from "@/lib/held-sends";
import { KIND_AUDIENCE } from "@/lib/today";
import { fileScopedShopContext } from "@/test/db";

const fileCtx = fileScopedShopContext();

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
const { holdRescheduleNotice } = await import("@/db/trip-rescheduled");
const { moveTrip } = await import("@/db/trips");

async function context() {
  const { db, shop } = fileCtx;
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
  form.set("holdKind", "seat_offer");
  form.set("tripId", tripId);
  form.set("discountPercent", "25");
  form.append("interestId", recipient);
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
      kind: "seat_offer",
      tripId: seat.tripId,
      interestIds: [owner.personId],
      discount: { percent: 25 },
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
      kind: "seat_offer",
      tripId: seat.tripId,
      interestIds: [owner.personId],
      discount: { amountCents: 2_000 },
    });
  });

  it("refuses a discount's kind with a blank amount, and holds nothing", async () => {
    const { db, shop, owner, seat } = await context();
    signIn(shop, owner);
    const form = dealForm(seat.tripId, owner.personId);
    form.delete("discountPercent");
    form.set("discount", " ");
    form.set("discountKind", "percent");
    await expect(holdSendAction(form)).rejects.toThrow("invalid_discount");
    expect(await heldRows(db, shop.id)).toEqual([]);
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

/**
 * Issue #2134: Today shows the wait-list row to owners and managers only, and
 * the action behind it holds the same line (decided 2026-10-13).
 */
describe("holdSendAction wait-list invite", () => {
  const waitlistForm = (tripId: string) => {
    const form = new FormData();
    form.set("holdKind", "seat_offer");
    form.set("tripId", tripId);
    form.set("interestId", crypto.randomUUID());
    return form;
  };

  // Security review S1: the gate reads the database, not the session's cached
  // roles. A token that still says manager for a person who is crew refuses.
  it("refuses a stale session that claims manager for a person the database says is crew", async () => {
    const { db, shop, captain, seat } = await context();
    vi.mocked(requireStaffSession).mockResolvedValue({
      user: { shopId: shop.id, personId: captain.personId, roles: ["manager"] },
    } as never);
    await expect(holdSendAction(waitlistForm(seat.tripId))).rejects.toThrow("not_authorized");
    expect(await heldRows(db, shop.id)).toEqual([]);
  });

  for (const role of ALL_ROLES) {
    const allowed = KIND_AUDIENCE.seat_wanted.includes(role);
    it(`${allowed ? "does not refuse" : "refuses"} a ${role}`, async () => {
      const { db, shop, owner, captain, seat } = await context();
      // The live roles are the database's: an owner for the roles the audience
      // admits, a captain (not in it) for the rest.
      const person = allowed ? owner : captain;
      vi.mocked(requireStaffSession).mockResolvedValue({
        user: { shopId: shop.id, personId: person.personId, roles: [role] },
      } as never);
      const attempt = holdSendAction(waitlistForm(seat.tripId));
      if (allowed) {
        await attempt.catch((error: unknown) => {
          expect((error as Error).message).not.toBe("not_authorized");
        });
      } else {
        await expect(attempt).rejects.toThrow("not_authorized");
        expect(await heldRows(db, shop.id)).toEqual([]);
      }
    });
  }
});

/**
 * A departure with a booked seat that a move can still slide a day later:
 * scheduled, upcoming, no head count against it.
 */
async function movableTrip(db: AppDb, shopId: string) {
  const candidates = await db
    .selectDistinct({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .innerJoin(bookings, eq(bookings.tripId, trips.id))
    .where(
      and(eq(trips.shopId, shopId), eq(trips.status, "scheduled"), eq(bookings.status, "booked")),
    );
  for (const trip of candidates.filter((row) => row.startsAt.getTime() > nowMs())) {
    const moved = await moveTrip(
      db,
      shopId,
      trip.id,
      new Date(trip.startsAt.getTime() + 24 * 60 * 60 * 1000),
    );
    if (moved.ok) return { tripId: trip.id, toldStartsAt: trip.startsAt };
  }
  throw new Error("fixture needs a movable departure with a booked seat");
}

function tellThemForm(
  tripId: string,
  previousStartsAt?: string,
  meetingPointMoved = "false",
): FormData {
  const form = new FormData();
  form.set("holdKind", "trip_rescheduled");
  form.set("tripId", tripId);
  if (previousStartsAt) form.set("previousStartsAt", previousStartsAt);
  form.set("meetingPointMoved", meetingPointMoved);
  return form;
}

/**
 * Security review of the reschedule notice: the "It was <time>" a diver reads
 * is the server's record of what they were told, never a posted field, and a
 * held send is taken back or sent early only by someone the hold's own gate
 * admits.
 */
describe("Tell them", () => {
  it("refuses when nothing records a move, whatever previous time is posted", async () => {
    const { db, shop, owner, seat } = await context();
    signIn(shop, owner);
    await expect(
      holdSendAction(tellThemForm(seat.tripId, "2020-01-01T06:00:00.000Z")),
    ).rejects.toThrow("nothing_to_send");
    expect(await heldRows(db, shop.id)).toEqual([]);
  });

  it("ignores a posted previous time and says the one the divers were told", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const { tripId, toldStartsAt } = await movableTrip(db, shop.id);
    const moveHeld = await holdRescheduleNotice(db, {
      shopId: shop.id,
      tripId,
      movedFrom: toldStartsAt,
      meetingPointMoved: false,
      actorPersonId: owner.personId,
    });
    if (!moveHeld) throw new Error("the move should hold a notice");
    expect(await undoHeldSendAction(moveHeld.id)).toBe(true);

    await holdSendAction(tellThemForm(tripId, "2020-01-01T06:00:00.000Z"));
    const [row] = await heldRows(db, shop.id);
    expect(row?.payload).toMatchObject({ previousStartsAt: toldStartsAt.toISOString() });
  });
});

describe("Tell them and the meeting point", () => {
  async function undoneMove(meetingPointMoved: boolean) {
    const ctx = await context();
    signIn(ctx.shop, ctx.owner);
    const { tripId, toldStartsAt } = await movableTrip(ctx.db, ctx.shop.id);
    const moveHeld = await holdRescheduleNotice(ctx.db, {
      shopId: ctx.shop.id,
      tripId,
      movedFrom: toldStartsAt,
      meetingPointMoved,
      actorPersonId: ctx.owner.personId,
    });
    if (!moveHeld) throw new Error("the move should hold a notice");
    expect(await undoHeldSendAction(moveHeld.id)).toBe(true);
    return { ...ctx, tripId };
  }

  it("ignores a posted meetingPointMoved when the meeting point never moved", async () => {
    const { db, shop, tripId } = await undoneMove(false);
    await holdSendAction(tellThemForm(tripId, undefined, "true"));
    const [row] = await heldRows(db, shop.id);
    expect(row?.payload).toMatchObject({ meetingPointMoved: false });
  });

  it("says the meeting point moved from the record, whatever is posted", async () => {
    const { db, shop, tripId } = await undoneMove(true);
    await holdSendAction(tellThemForm(tripId, undefined, "false"));
    const [row] = await heldRows(db, shop.id);
    expect(row?.payload).toMatchObject({ meetingPointMoved: true });
  });
});

describe("undo and early release", () => {
  async function heldNotice() {
    const ctx = await context();
    const { tripId, toldStartsAt } = await movableTrip(ctx.db, ctx.shop.id);
    const held = await holdRescheduleNotice(ctx.db, {
      shopId: ctx.shop.id,
      tripId,
      movedFrom: toldStartsAt,
      meetingPointMoved: false,
      actorPersonId: ctx.owner.personId,
    });
    if (!held) throw new Error("the move should hold a notice");
    return { ...ctx, held };
  }

  it("answers a malformed id with nothing done rather than a throw", async () => {
    const { db, shop, owner, held } = await heldNotice();
    signIn(shop, owner);
    expect(await undoHeldSendAction("not-a-uuid")).toBe(false);
    expect(await releaseHeldSendAction("not-a-uuid")).toEqual({ status: "gone" });
    expect((await heldRows(db, shop.id)).map((row) => row.id)).toEqual([held.id]);
  });

  it("refuses a captain's Undo of a manager's reschedule notice", async () => {
    const { db, shop, captain, held } = await heldNotice();
    signIn(shop, captain);
    await expect(undoHeldSendAction(held.id)).rejects.toThrow("not_authorized");
    expect((await heldRows(db, shop.id)).map((row) => row.id)).toEqual([held.id]);
  });

  it("refuses a captain's early release of it", async () => {
    const { db, shop, captain, held } = await heldNotice();
    signIn(shop, captain);
    await expect(releaseHeldSendAction(held.id)).rejects.toThrow("not_authorized");
    expect((await heldRows(db, shop.id)).map((row) => row.id)).toEqual([held.id]);
  });

  it("refuses a captain's Undo of an owner's deal blast", async () => {
    const { db, shop, owner, captain, seat } = await context();
    signIn(shop, owner);
    const ticket = await holdSendAction(dealForm(seat.tripId, owner.personId));
    signIn(shop, captain);
    await expect(undoHeldSendAction(ticket.id)).rejects.toThrow("not_authorized");
    expect(await heldRows(db, shop.id)).toHaveLength(1);
  });
});
