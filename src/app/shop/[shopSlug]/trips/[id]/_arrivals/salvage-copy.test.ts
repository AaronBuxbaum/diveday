import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { SimilarDeparture } from "@/lib/similar-departures";
import { noShowSalvageCopy, sailedRebookCopy } from "./salvage-copy";

const t = staffTranslator("en-US");

const departure: SimilarDeparture = {
  tripId: "trip-2",
  title: "Two-Tank Reef",
  startsAt: new Date("2026-09-12T14:00:00.000Z"),
  reason: "same_site",
};

function copyFor(offer: Parameters<typeof noShowSalvageCopy>[0]["offer"]) {
  return noShowSalvageCopy({
    t,
    offer,
    shopSlug: "blue-mantis",
    tripId: "trip-1",
    diver: { id: "person-1", name: "Nadia Petrov" },
    formatWhen: () => "Sat 8:00 AM",
  });
}

describe("noShowSalvageCopy", () => {
  it("sends a waiting diver's seat to the shipped invite on the guest list", () => {
    const copy = copyFor({ kind: "waitlist", count: 2 });

    expect(copy.line).toBe("2 divers are waiting for this seat");
    expect(copy.links).toEqual([
      { href: "/shop/blue-mantis/trips/trip-1#waitlist", label: "Open the wait list" },
    ]);
  });

  /**
   * **The second offer names the person it is for** (dive-domain-expert review,
   * 2026-09-11). A departure cannot take a seat on a different departure, so
   * this branch is a rebooking for the diver who just missed — not a list of
   * boats with room, which on a shared desk tablet read as either "rebook them"
   * or "go and find a stranger" with nothing on screen to settle it.
   */
  it("names the diver the rebooking is for", () => {
    expect(copyFor({ kind: "rebook", departures: [departure] }).line).toBe(
      "Nobody is waiting. Offer Nadia Petrov another day.",
    );
  });

  /**
   * And the link seats *them*: the shipped booking door for that departure with
   * the diver already searched, the same `?diverq=` hand-off the counter's own
   * walk-in link makes. A link to the departure's staff page would put a
   * staffer on a screen with nothing about this diver on it.
   */
  it("links to seating that diver on the day, not to the day's staff page", () => {
    expect(copyFor({ kind: "rebook", departures: [departure] }).links).toEqual([
      {
        href: "/shop/blue-mantis/bookings/new/trip-2?diverq=Nadia%20Petrov",
        label: "Add them to Two-Tank Reef, Sat 8:00 AM",
        offer: {
          tripId: "trip-2",
          ariaLabel: "Email Nadia Petrov an offer for Two-Tank Reef, Sat 8:00 AM",
        },
      },
    ]);
  });

  /**
   * **And the same day can go to the diver** (UX review 2026-10-11, item 14):
   * one tap emails them the offer for the person the line names, so the desk
   * does not have to reach them by hand to say what it already knows.
   */
  it("sends the rebooking offer to the diver the line names, and only on that branch", () => {
    expect(copyFor({ kind: "rebook", departures: [departure] }).offerCopy).toEqual({
      personId: "person-1",
      label: "Email them this date",
      pending: "Sending…",
      sendFailed: "That didn’t send. Tap it again.",
    });
    expect(copyFor({ kind: "waitlist", count: 1 }).offerCopy).toBeUndefined();
    expect(copyFor({ kind: "none" }).offerCopy).toBeUndefined();
  });

  it("offers nothing, with no link, rather than inventing an offer", () => {
    const copy = copyFor({ kind: "none" });

    expect(copy.line).toBe("Nobody is waiting, and no similar departure has room for them.");
    expect(copy.links).toEqual([]);
  });

  /**
   * The money is a sentence and a door to the diver's orders on every branch —
   * `markBookingNoShow` writes no order, payment or refund row at all, and the
   * panel says where that decision lives rather than making it.
   */
  it("states the money on every branch and points at the diver's orders", () => {
    for (const offer of [
      { kind: "waitlist", count: 1 },
      { kind: "rebook", departures: [departure] },
      { kind: "none" },
    ] as const) {
      const { money } = copyFor(offer);
      expect(money.line).toBe("Marking someone not here does not charge or refund anything.");
      expect(money.href).toBe("/shop/blue-mantis/orders?personId=person-1");
    }
  });
});

/** Fifth-loop ideas, item 4: the sailed list becomes the rebooking list. */
describe("sailedRebookCopy", () => {
  const diver = { id: "person-1", name: "Nadia Petrov" };
  const formatWhen = (startsAt: Date) =>
    startsAt.getUTCDay() === 4 ? "Thu 7:00 AM" : "Sat 11:30 AM";

  it("says the later seat a diver already holds, and offers nothing", () => {
    const copy = sailedRebookCopy({
      t,
      next: { kind: "booked", tripId: "trip-9", startsAt: new Date("2026-09-12T15:30:00Z") },
      shopSlug: "blue-mantis",
      diver,
      formatWhen,
    });
    expect(copy).toEqual({ line: "Booked Sat 11:30 AM" });
  });

  it("names an open day with its seats, and both doors to it", () => {
    const copy = sailedRebookCopy({
      t,
      next: {
        kind: "open",
        tripId: "trip-2",
        title: "Two-Tank Reef",
        startsAt: new Date("2026-09-10T11:00:00Z"),
        seatsLeft: 3,
      },
      shopSlug: "blue-mantis",
      diver,
      formatWhen,
    });
    expect(copy.line).toBe("Nothing else booked · Thu 7:00 AM has 3 seats");
    expect(copy.add).toEqual({
      href: "/shop/blue-mantis/bookings/new/trip-2?diverq=Nadia%20Petrov",
      label: "Add them",
      ariaLabel: "Add Nadia Petrov to Two-Tank Reef, Thu 7:00 AM",
    });
    expect(copy.offer).toMatchObject({
      tripId: "trip-2",
      personId: "person-1",
      label: "Email them this date",
    });
  });

  it("speaks Spanish", () => {
    const copy = sailedRebookCopy({
      t: staffTranslator("es-ES"),
      next: {
        kind: "open",
        tripId: "trip-2",
        title: "Two-Tank Reef",
        startsAt: new Date("2026-09-10T11:00:00Z"),
        seatsLeft: 1,
      },
      shopSlug: "blue-mantis",
      diver,
      formatWhen,
    });
    expect(copy.line).toBe("Nada más reservado · Thu 7:00 AM tiene 1 plaza");
  });
});
