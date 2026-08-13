import { describe, expect, it } from "vitest";
import { SEAT_SURFACES, type SeatLanding, type SeatSurfaceId } from "./seat-diver-surfaces";

/**
 * A `SeatLanding` is built from raw form fields precisely when zod *failed* —
 * `seatExistingDiverAction` falls back to `String(formData.get("tripId"))` so a
 * staffer still lands back on the page they submitted from. Every path below
 * therefore has to survive an id that is not a uuid.
 *
 * Not an open redirect: every template starts with a literal `/shop/`, and the
 * caller is an authenticated staffer submitting their own form. What an
 * unescaped segment *could* still do is rewrite the URL the notice is appended
 * to — a `?` or `#` in the middle of a path turns the rest of it into a query
 * or a fragment, and `../` walks to a different route than the one named
 * (security review finding, nit).
 */

const ids: SeatSurfaceId[] = ["trip-guests", "walk-in", "diver-record", "new-booking"];

const hostile: Array<[string, string]> = [
  ["?notice=diver-added", "a query string"],
  ["#anchor", "a fragment"],
  ["../../divers", "a path traversal"],
  ["a/b", "an embedded slash"],
  ["a b", "a space"],
  ["https://evil.example.com", "an absolute URL"],
];

/** A benign landing, for comparing shapes against. */
const benign: SeatLanding = {
  shopSlug: "blue-mantis",
  tripId: "11111111-1111-4111-8111-111111111111",
  personId: "22222222-2222-4222-8222-222222222222",
};

describe("every seat surface escapes what it puts in a path segment", () => {
  for (const id of ids) {
    const surface = SEAT_SURFACES[id];
    describe(id, () => {
      it.each(hostile)("keeps %s (%s) inside one segment", (value) => {
        const landing: SeatLanding = { shopSlug: value, tripId: value, personId: value };
        for (const build of [surface.seatedPath, surface.refusedPath] as const) {
          const path = build(landing);
          expect(path.startsWith("/shop/")).toBe(true);
          // No query and no fragment: a `?` or `#` in the middle of a path
          // turns everything after it — including the `?notice=` the caller is
          // about to append — into something else.
          expect(path).not.toMatch(/[?#]/);
          // And no extra segments: the route it lands on is the route the
          // template names, whatever the form submitted.
          expect(path.split("/")).toHaveLength(build(benign).split("/").length);
        }
      });
    });
  }

  it("still builds the ordinary paths unchanged", () => {
    const landing: SeatLanding = {
      shopSlug: "blue-mantis",
      tripId: "11111111-1111-4111-8111-111111111111",
      personId: "22222222-2222-4222-8222-222222222222",
    };
    expect(SEAT_SURFACES["trip-guests"].refusedPath(landing)).toBe(
      "/shop/blue-mantis/trips/11111111-1111-4111-8111-111111111111/guests",
    );
    expect(SEAT_SURFACES["diver-record"].refusedPath(landing)).toBe(
      "/shop/blue-mantis/divers/22222222-2222-4222-8222-222222222222",
    );
    expect(SEAT_SURFACES["new-booking"].refusedPath(landing)).toBe(
      "/shop/blue-mantis/bookings/new/11111111-1111-4111-8111-111111111111",
    );
    expect(SEAT_SURFACES["new-booking"].refusedPath({ ...landing, tripId: "" })).toBe(
      "/shop/blue-mantis/bookings/new",
    );
  });
});

/**
 * The `?gate=` signature is bound to the id the landing route owns
 * (src/lib/trip-admission-gate.ts). A surface that returned the *wrong* one
 * would mint a signature its own reader could never verify — a specific refusal
 * silently downgraded to the generic sentence on every gate refusal.
 */
describe("gate scope matches the id in each landing path", () => {
  const landing: SeatLanding = {
    shopSlug: "blue-mantis",
    tripId: "11111111-1111-4111-8111-111111111111",
    personId: "22222222-2222-4222-8222-222222222222",
  };

  it.each([
    ["trip-guests", { kind: "trip", id: landing.tripId }],
    ["new-booking", { kind: "trip", id: landing.tripId }],
    ["diver-record", { kind: "diver", id: landing.personId }],
    // The counter used to be the exception here: `refusals: "coarse"` collapsed
    // every gate into "open its trip page for the reason", so there was no
    // specific refusal for a signature to carry and `gateScope` returned null.
    // It says which gate it was now, and the departure is a path segment on the
    // route it lands back on — which is the id the signature binds to.
    ["walk-in", { kind: "trip", id: landing.tripId }],
  ] as const)("%s binds to %o", (id, scope) => {
    expect(SEAT_SURFACES[id].gateScope(landing)).toEqual(scope);
  });

  it("carries no gate on a surface with no departure to bind one to", () => {
    // A submission so broken that zod could not even read a trip id off it.
    // There is no route to land on that owns one, so there is nothing a
    // signature could be verified against — better silent than unverifiable.
    const noTrip: SeatLanding = { ...landing, tripId: "" };
    expect(SEAT_SURFACES["walk-in"].gateScope(noTrip)).toBeNull();
    expect(SEAT_SURFACES["new-booking"].gateScope(noTrip)).toBeNull();
  });
});
