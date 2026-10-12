import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { tripPulseFacts } from "./trip-pulse-facts";

const t = staffTranslator("en-US");

type Input = Parameters<typeof tripPulseFacts>[0];

function input(over: Partial<Input> = {}): Input {
  return {
    pulseNeeded: true,
    pulse: { blocked: 0, prepGaps: 0, openOrders: 0 } as Input["pulse"],
    crewGap: { code: "none" } as Input["crewGap"],
    requirement: { minimumCertificationLevel: null } as unknown as Input["requirement"],
    cancelled: false,
    course: null,
    liveBoatClashes: [],
    shopSlug: "blue-mantis",
    tripId: "trip-1",
    t,
    ...over,
  };
}

describe("tripPulseFacts", () => {
  it("is empty when the pulse is not needed", () => {
    expect(tripPulseFacts(input({ pulseNeeded: false, pulse: { blocked: 3 } as never }))).toEqual(
      [],
    );
  });

  it("leads with the blocked rows, in danger, pointing at the roster", () => {
    const [blocked] = tripPulseFacts(
      input({ pulse: { blocked: 2, prepGaps: 0, openOrders: 0 } as never }),
    );
    expect(blocked).toMatchObject({
      href: "/shop/blue-mantis/trips/trip-1#roster",
      tone: "danger",
    });
  });

  it("asks for requirements on a fun dive with none, never on a course or a cancelled trip", () => {
    const facts = tripPulseFacts(input({ requirement: null as never }));
    expect(facts.map((fact) => fact.href)).toEqual(["?view=details#requirements"]);
    expect(tripPulseFacts(input({ requirement: null as never, cancelled: true }))).toEqual([]);
    expect(tripPulseFacts(input({ requirement: null as never, course: { id: "c" } as never }))).toEqual([]);
  });

  it("opens the other departure for a hull clash", () => {
    const facts = tripPulseFacts(
      input({
        liveBoatClashes: [
          { boatName: "Reef Runner", otherTitle: "Night", otherTripId: "trip-2" },
        ] as never,
      }),
    );
    expect(facts[0]?.href).toBe("/shop/blue-mantis/trips/trip-2");
  });

  it("puts money owed last, in neutral ink, over every open order for the trip", () => {
    const facts = tripPulseFacts(
      input({ pulse: { blocked: 1, prepGaps: 2, openOrders: 1 } as never }),
    );
    const last = facts.at(-1);
    expect(last?.href).toBe("/shop/blue-mantis/orders?tripId=trip-1&status=open&range=all");
    expect(last?.tone).toBeUndefined();
    expect(facts[1]?.href).toContain("/prep#");
  });
});
