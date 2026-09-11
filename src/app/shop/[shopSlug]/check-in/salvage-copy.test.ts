import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { SimilarDeparture } from "@/lib/similar-departures";
import { noShowSalvageCopy } from "./salvage-copy";

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
      { href: "/shop/blue-mantis/trips/trip-1/guests", label: "Open the wait list" },
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
      },
    ]);
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
