import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { callTripBlowout } from "./blowouts";
import { createBoat } from "./boats";
import { createBookingParty } from "./bookings";
import { people, personRoles } from "./schema";
import { createTrip } from "./trips";
import { changeTripCrew } from "./trips-crew";

const fileCtx = fileScopedShopContext();
const HOUR = 60 * 60 * 1_000;

beforeEach(() => {
  vi.stubEnv("APP_HOST", "https://diveday.example");
});

describe("trip blowout alternatives with assigned crew", () => {
  it("does not offer a boat whose passenger places are reserved by assigned crew", async () => {
    const { db, shop } = fileCtx;
    const now = nowDate();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Storm-Test Two-Tank",
      startsAt: new Date(now.getTime() + 20 * HOUR),
      endsAt: new Date(now.getTime() + 24 * HOUR),
      capacity: 12,
      plannedDives: 2,
    });
    if (!trip) throw new Error("test trip could not be created");
    const booking = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Ada Storm",
        email: "ada.storm@example.com",
      },
    ]);
    if (!booking.ok) throw new Error(`test roster could not be booked: ${booking.reason}`);

    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")))
      .limit(1);
    if (!owner) throw new Error("seeded owner missing");

    const boat = await createBoat(db, shop.id, "Two total occupants", 2);
    const candidateTitle = "Crew-reserved alternative";
    const candidate = await createTrip(db, {
      shopId: shop.id,
      title: candidateTitle,
      startsAt: new Date(now.getTime() + 2 * HOUR),
      endsAt: new Date(now.getTime() + 6 * HOUR),
      capacity: 4,
      boatId: boat.id,
      priceCents: 10_000,
    });
    if (!candidate) throw new Error("candidate trip could not be created");
    const candidateBooking = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: candidate.id,
        fullName: "Already booked passenger",
      },
    ]);
    expect(candidateBooking.ok).toBe(true);
    const [crew] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Assigned candidate crew" })
      .returning();
    if (!crew) throw new Error("crew insert returned no row");
    await db.insert(personRoles).values({ personId: crew.id, role: "captain" });
    expect(
      await changeTripCrew(db, shop.id, candidate.id, {
        operation: "assign",
        personId: crew.id,
      }),
    ).toBe(true);

    const email = fakeEmail();
    const outcome = await callTripBlowout(db, {
      shopId: shop.id,
      tripId: trip.id,
      calledByPersonId: owner.id,
      provider: email.provider,
    });
    expect(outcome).toMatchObject({ ok: true, sent: 1 });
    const send = email.sent.find((notice) => notice.kind === "trip_blowout");
    if (send?.kind !== "trip_blowout") throw new Error("blowout notice was not sent");
    expect(send.alternatives.some(({ title }) => title === candidateTitle)).toBe(false);
  });
});
