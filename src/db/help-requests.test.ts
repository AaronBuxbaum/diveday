import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  getHelpRequestForBooking,
  listTodayHelpRequests,
  saveHelpRequest,
  updateHelpRequestStatus,
} from "./help-requests";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

describe("day-of help requests", () => {
  it("moves one request from diver choice to acknowledgement to handled", async () => {
    const { db, shop } = await seededShopContext();
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
      (row) => row.title === "Two-Tank Reef — Molasses & French",
    );
    if (!trip) throw new Error("expected seeded trip missing");
    const [seat] = await getTripRoster(db, shop.id, trip.id);
    const [staff] = await listStaff(db, shop.id);
    if (!seat || !staff) throw new Error("expected seeded seat and staff");
    const now = new Date(trip.startsAt.getTime() - 60 * 60 * 1000);

    const saved = await saveHelpRequest(db, {
      shopId: shop.id,
      bookingId: seat.booking.id,
      kind: "carry_gear",
      now,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok || !saved.request) throw new Error("expected request to save");
    expect(saved.request.status).toBe("requested");

    expect(await listTodayHelpRequests(db, shop.id, [trip.id], now)).toMatchObject([
      {
        id: saved.request.id,
        bookingId: seat.booking.id,
        kind: "carry_gear",
        status: "requested",
        personName: seat.person.fullName,
      },
    ]);

    const handledTooSoon = await updateHelpRequestStatus(db, {
      shopId: shop.id,
      requestId: saved.request.id,
      status: "handled",
      actorPersonId: staff.person.id,
      now,
    });
    expect(handledTooSoon).toEqual({ ok: false, reason: "invalid_transition" });

    const acknowledged = await updateHelpRequestStatus(db, {
      shopId: shop.id,
      requestId: saved.request.id,
      status: "acknowledged",
      actorPersonId: staff.person.id,
      now,
    });
    expect(acknowledged.ok).toBe(true);
    if (!acknowledged.ok) throw new Error("expected acknowledgement to save");
    expect(acknowledged.request.acknowledgedAt).toEqual(now);

    const handled = await updateHelpRequestStatus(db, {
      shopId: shop.id,
      requestId: saved.request.id,
      status: "handled",
      actorPersonId: staff.person.id,
      now,
    });
    expect(handled.ok).toBe(true);
    if (!handled.ok) throw new Error("expected handled request to save");
    expect(handled.request.status).toBe("handled");
    expect(handled.request.handledAt).toEqual(now);
    expect(await listTodayHelpRequests(db, shop.id, [trip.id], now)).toEqual([]);
    expect((await getHelpRequestForBooking(db, shop.id, seat.booking.id, now))?.status).toBe(
      "handled",
    );

    expect(
      await saveHelpRequest(db, {
        shopId: shop.id,
        bookingId: seat.booking.id,
        kind: "none",
        now,
      }),
    ).toEqual({ ok: false, reason: "handled" });
  });
});
