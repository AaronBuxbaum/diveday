import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { TodayAction } from "@/lib/today";
import { tripPulseFacts } from "./trip-pulse-facts";

const t = staffTranslator("en-US");
const noWork = {
  missingSize: 0,
  kitUnasked: 0,
  ungatedNitrox: 0,
  missingContact: 0,
  openOrders: 0,
};
const now = new Date("2026-10-13T12:00:00Z");

type Input = Parameters<typeof tripPulseFacts>[0];

function input(over: Partial<Input> = {}): Input {
  return {
    pulseNeeded: true,
    pulse: { blocked: 0, boarded: 0, work: noWork } as Input["pulse"],
    crewGap: { code: "none" } as Input["crewGap"],
    requirement: { minimumCertificationLevel: null } as unknown as Input["requirement"],
    cancelled: false,
    course: null,
    liveBoatClashes: [],
    shopSlug: "blue-mantis",
    tripId: "trip-1",
    startsAt: new Date("2026-10-14T03:30:00Z"),
    now,
    needs: null,
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
    const [blocked] = tripPulseFacts(input({ pulse: { blocked: 2, boarded: 0, work: noWork } }));
    expect(blocked).toMatchObject({
      href: "/shop/blue-mantis/trips/trip-1#roster",
      tone: "danger",
    });
  });

  it("asks for requirements on a fun dive with none, never on a course or a cancelled trip", () => {
    const facts = tripPulseFacts(input({ requirement: null as never }));
    expect(facts.map((fact) => fact.href)).toEqual(["?view=details#requirements"]);
    expect(tripPulseFacts(input({ requirement: null as never, cancelled: true }))).toEqual([]);
    expect(
      tripPulseFacts(input({ requirement: null as never, course: { id: "c" } as never })),
    ).toEqual([]);
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
      input({
        pulse: { blocked: 1, boarded: 0, work: { ...noWork, missingSize: 2, openOrders: 1 } },
      }),
    );
    const last = facts.at(-1);
    expect(last?.href).toBe("/shop/blue-mantis/orders?tripId=trip-1&status=open&range=all");
    expect(last?.tone).toBeUndefined();
    expect(facts[1]?.href).toContain("/prep#");
  });

  it("outside Today's window, lists the boat's work alone", () => {
    const facts = tripPulseFacts(
      input({
        pulse: {
          blocked: 0,
          boarded: 0,
          work: { ...noWork, missingSize: 1, kitUnasked: 3, missingContact: 3, openOrders: 2 },
        },
      }),
    );
    expect(facts.map((fact) => fact.text)).toEqual([
      "1 missing a size · 3 not asked about kit",
      "3 people have no emergency contact.",
      "2 orders awaiting payment",
    ]);
    expect(facts[1]?.href).toBe("/shop/blue-mantis/trips/trip-1#roster");
    expect(facts.every((fact) => fact.tone === undefined)).toBe(true);
  });

  it("reads ungated nitrox in warning ink, below the hazards and above the neutral work", () => {
    const facts = tripPulseFacts(
      input({
        pulse: {
          blocked: 1,
          boarded: 0,
          work: {
            missingSize: 2,
            kitUnasked: 0,
            ungatedNitrox: 3,
            missingContact: 0,
            openOrders: 1,
          },
        },
      }),
    );
    const nitrox = facts.find((fact) => fact.href.includes("/prep#") && fact.tone === "warning");
    expect(nitrox).toBeDefined();
    expect(facts.map((fact) => fact.tone ?? "work")).toEqual(["danger", "work", "warning", "work"]);
  });

  // Fourth review, item 36: the band said "3 things to sort" while Today listed
  // seven rows for the same boat. In Today's window the band is Today's rows.
  it("in Today's window, lists exactly Today's rows for the boat, in Today's words", () => {
    const row = (over: Partial<TodayAction>): TodayAction =>
      ({
        id: "x",
        kind: "dive_prep",
        urgency: "today",
        subject: "Two-Tank Reef",
        context: null,
        detail: "",
        actionLabel: "Open",
        href: "/shop/blue-mantis/trips/trip-1/prep#prep",
        dueAt: null,
        ...over,
      }) as TodayAction;
    const needs = [
      row({
        id: "help-request:1",
        subject: "Diego Alvarez",
        detail: "Asked for help: carry gear.",
        href: "/shop/blue-mantis/trips/trip-1#booking-b1",
      }),
      row({
        id: "say-hello:trip-1",
        aboutDeparture: true,
        detail: "Say hello to Ana.",
        href: "/shop/blue-mantis/trips/trip-1",
      }),
      row({
        id: "prep:trip-1",
        aboutDeparture: true,
        detail: "1 missing a size · 3 not asked about kit",
      }),
    ];
    const facts = tripPulseFacts(
      input({ needs, pulse: { blocked: 0, boarded: 0, work: { ...noWork, openOrders: 5 } } }),
    );
    expect(facts.map((fact) => fact.text)).toEqual([
      "Diego Alvarez · Asked for help: carry gear",
      "Say hello to Ana",
      "1 missing a size · 3 not asked about kit",
    ]);
    // A row that opens this very page lands on its roster, never a dead tap.
    expect(facts[1]?.href).toBe("/shop/blue-mantis/trips/trip-1#roster");
    expect(new Set(facts.map((fact) => fact.key)).size).toBe(3);
  });
});
