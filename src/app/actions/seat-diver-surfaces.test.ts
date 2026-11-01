import { describe, expect, it } from "vitest";
import type { SeatDiverRefusal } from "@/db/seat-diver";
import {
  SEAT_SURFACES,
  type SeatLanding,
  type SeatSurfaceId,
  seatSurfaceFor,
} from "./seat-diver-surfaces";

/**
 * A `SeatLanding` is built from raw form fields precisely when zod *failed* —
 * `seatExistingDiverAction` falls back to the raw `tripId` field (`rawLanding`) so a
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

const ids: SeatSurfaceId[] = ["departure", "diver"];

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
    // From a departure, seated or refused, the staffer lands on that boat's
    // Divers tab — the roster's add-diver band, the global Add booking and the
    // counter walk-in all stand on the same boat.
    expect(SEAT_SURFACES.departure.seatedPath(landing)).toBe(
      "/shop/blue-mantis/trips/11111111-1111-4111-8111-111111111111",
    );
    expect(SEAT_SURFACES.departure.refusedPath(landing)).toBe(
      "/shop/blue-mantis/trips/11111111-1111-4111-8111-111111111111",
    );
    // From a diver, both land on that diver's record.
    expect(SEAT_SURFACES.diver.seatedPath(landing)).toBe(
      "/shop/blue-mantis/divers/22222222-2222-4222-8222-222222222222",
    );
    expect(SEAT_SURFACES.diver.refusedPath(landing)).toBe(
      "/shop/blue-mantis/divers/22222222-2222-4222-8222-222222222222",
    );
  });
});

/**
 * A seating has three outcomes a staffer acts on differently, and each door
 * owes three distinct codes for them. The plain one is the only one that lets
 * the staffer walk away; the other two each name work still at the desk.
 *
 * The held seat is the one that was missing. A seat taken off the counter's
 * "is this the same diver?" prompt is identity-unconfirmed, so the boarding
 * gate refuses it (H-20260724-one-person-per-email, issue #1556) — and every door answered that with the
 * same "Added" it answers an ordinary seat with. The staffer met the hold on
 * the next tap instead: a check-in refusal, with the diver at the counter and
 * the confirm control on the trip roster (`dive-domain-expert`, 2026-09-11).
 * A door whose held-seat code collapses back onto its plain one reopens that.
 */
describe("every seat surface says a held seat is held", () => {
  for (const id of ids) {
    const surface = SEAT_SURFACES[id];
    it(`${id} names a code of its own for an identity-unconfirmed seat`, () => {
      const { seatedNotice, seatedWaiverUndeliveredNotice, seatedIdentityUnconfirmedNotice } =
        surface;
      expect(
        new Set([seatedNotice, seatedWaiverUndeliveredNotice, seatedIdentityUnconfirmedNotice])
          .size,
      ).toBe(3);
      // The one spelling a notice code is allowed to have — a code the landing
      // page's map cannot match renders no banner at all
      // (src/lib/staff-notices.ts, `NOTICE_CODE_PATTERN`).
      expect(seatedIdentityUnconfirmedNotice).toMatch(/^[a-z0-9-]+$/);
    });
  }
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
    ["departure", { kind: "trip", id: landing.tripId }],
    ["diver", { kind: "diver", id: landing.personId }],
  ] as const)("%s binds to %o", (id, scope) => {
    expect(SEAT_SURFACES[id].gateScope(landing)).toEqual(scope);
  });

  it("carries no gate on a surface with no departure to bind one to", () => {
    // A submission so broken that zod could not even read a trip id off it.
    // There is no route to land on that owns one, so there is nothing a
    // signature could be verified against — better silent than unverifiable.
    const noTrip: SeatLanding = { ...landing, tripId: "" };
    expect(SEAT_SURFACES.departure.gateScope(noTrip)).toBeNull();
  });
});

/**
 * Both doors answer every refusal the booking transaction can give, and a
 * refusal never collapses onto a success: the shared vocabulary is exhaustive
 * by type, and this pins that each gate keeps a distinct, well-formed code so
 * a page's notice map can find it. The counter used to keep a second map of
 * the same twelve refusals; it speaks the departure door's now.
 */
describe("every refusal keeps its own code on both doors", () => {
  const refusals: SeatDiverRefusal[] = [
    "trip_full",
    "divers_full",
    "participant_type_unavailable",
    "already_booked",
    "course_unstaffed",
    "course_prerequisite",
    "course_ratio_full",
    "course_min_age",
    "trip_prerequisite",
    "trip_unavailable",
    "person_not_found",
    "unavailable",
  ];

  for (const id of ids) {
    it(`${id} answers each gate, none with a success code`, () => {
      const surface = SEAT_SURFACES[id];
      const successes = new Set([
        surface.seatedNotice,
        surface.seatedWaiverUndeliveredNotice,
        surface.seatedIdentityUnconfirmedNotice,
        surface.seatedConfirmationSentNotice,
        ...Object.values(surface.walkIn ?? {}).filter((value) => value.length > 0),
      ]);
      for (const reason of refusals) {
        const code = surface.refusalNotice[reason];
        expect(code).toMatch(/^[a-z0-9-]+$/);
        expect(successes.has(code)).toBe(false);
      }
      // The boat's own certification gate and the course gates stay apart: the
      // staffer's next move differs (DOM-M6).
      expect(surface.refusalNotice.trip_prerequisite).not.toBe(
        surface.refusalNotice.course_prerequisite,
      );
      expect(surface.refusalNotice.trip_full).not.toBe(surface.refusalNotice.course_ratio_full);
    });
  }

  it("the departure door has no second refusal vocabulary for the counter", () => {
    const counter = seatSurfaceFor(SEAT_SURFACES.departure, {
      shopSlug: "blue-mantis",
      tripId: "11111111-1111-4111-8111-111111111111",
      personId: "",
      walkIn: true,
    });
    expect(counter.refusalNotice).toBe(SEAT_SURFACES.departure.refusalNotice);
    expect(counter.refusals).toBe("specific");
  });
});

/**
 * The counter is a mode of the departure door, asked for per submission. It
 * changes how the seat is recorded and worded and nothing about who may take
 * it: the same refusals, the same gate scope, the same landing.
 */
describe("the departure door's counter mode", () => {
  const landing: SeatLanding = {
    shopSlug: "blue-mantis",
    tripId: "11111111-1111-4111-8111-111111111111",
    personId: "",
  };

  it("records a walk-in and words it as one", () => {
    const counter = seatSurfaceFor(SEAT_SURFACES.departure, { ...landing, walkIn: true });
    expect(counter.entry).toBe("walk_in");
    expect(counter.seatedNotice).toBe("walkin-added");
    expect(counter.seatedIdentityUnconfirmedNotice).toBe("walkin-added-identity-unconfirmed");
    expect(counter.seatedWaiverUndeliveredNotice).toBe("walkin-added-waiver-undelivered");
    expect(counter.seatedConfirmationSentNotice).toBe("walkin-added-confirmed");
  });

  it("is an ordinary roster seat when it was not asked for", () => {
    expect(seatSurfaceFor(SEAT_SURFACES.departure, landing).entry).toBe("roster");
    expect(seatSurfaceFor(SEAT_SURFACES.departure, { ...landing, walkIn: false }).entry).toBe(
      "roster",
    );
  });

  it("is not a thing a diver's record can be asked for", () => {
    const door = seatSurfaceFor(SEAT_SURFACES.diver, { ...landing, walkIn: true });
    expect(door).toBe(SEAT_SURFACES.diver);
    expect(door.entry).toBe("roster");
  });

  it("changes neither the landing nor what the gate signature binds to", () => {
    const counter = seatSurfaceFor(SEAT_SURFACES.departure, { ...landing, walkIn: true });
    expect(counter.seatedPath(landing)).toBe(SEAT_SURFACES.departure.seatedPath(landing));
    expect(counter.refusedPath(landing)).toBe(SEAT_SURFACES.departure.refusedPath(landing));
    expect(counter.gateScope(landing)).toEqual(SEAT_SURFACES.departure.gateScope(landing));
  });
});
