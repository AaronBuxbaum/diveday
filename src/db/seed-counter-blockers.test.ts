import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { listTripReadiness } from "./readiness";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **The fixture's whole reason to exist is the size of one diver's blocker
 * stack**, and nothing asserted it. `seedCounterBlockers` produces the only
 * five-at-once diver in the seed — the case the check-in counter's reason list
 * renders in full — and its docblock lists five constraints it must keep, none
 * of which a test held it to.
 *
 * That gap is why issue #692 could sit in the seed: the trip was shipped
 * unpriced *and* publicly bookable, and the only thing anyone checked was that
 * the counter still looked right.
 */
describe("the counter's five-blocker fixture", () => {
  async function counterTrip() {
    const { db, shop } = await seededShopContext();
    const trip = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Deep Wreck Charter"),
    );
    if (!trip) throw new Error("seed: the counter-blocked charter is missing");
    return { db, shop, trip };
  }

  it("still blocks its diver for five separate reasons", async () => {
    const { db, shop, trip } = await counterTrip();
    const roster = await listTripReadiness(db, shop.id, trip.id);
    const tomas = roster.find((row) => row.person.fullName === "Tomás Ferreira");
    if (!tomas) throw new Error("seed: the counter-blocked diver is missing");

    // Named, not counted: a count of five passes just as happily if the payment
    // blocker is swapped for a second certification one, and it is precisely
    // the payment rung that pricing the trip could have taken away.
    expect(new Set(tomas.readiness.blockers.map((blocker) => blocker.code))).toEqual(
      new Set([
        "waiver_not_sent",
        "certification_missing",
        "specialty_missing",
        "nitrox_missing",
        "payment_due",
      ]),
    );
  });

  it("carries a price, because it is publicly for sale and says 'paid at booking'", async () => {
    const { trip } = await counterTrip();
    // `is_private` defaults to false, so this sits on /s/blue-mantis between two
    // priced charters. Unpriced, `checkoutCharge` returns null, the booking
    // action never asks for money, and `payment_due` stands forever for every
    // diver who takes a seat (issue #692).
    expect(trip.priceCents).toBeGreaterThan(0);
  });

  it("still leaves seven seats, which the e2e fleet matches trips by", async () => {
    const { trip } = await counterTrip();
    expect(trip.capacity - trip.booked).toBe(7);
  });
});
