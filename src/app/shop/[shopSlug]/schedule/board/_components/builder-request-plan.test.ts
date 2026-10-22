import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { builderRequestPlan } from "./builder-request-plan";

const st = staffTranslator("en-US");
type Input = Parameters<typeof builderRequestPlan>[0];

const shop = {
  crewScheduleEnabled: true,
  diversPerDivemaster: 6,
  hasBoatDiving: true,
} as unknown as Input["shop"];

function request(over: Record<string, unknown>) {
  return {
    id: "r1",
    name: "Tomás",
    partySize: 4,
    experienceLevel: null,
    courseId: null,
    courseTitle: null,
    interest: "two-tank",
    ...over,
  };
}

describe("builderRequestPlan", () => {
  it("is null when the link carried no requests", () => {
    expect(builderRequestPlan({ requestRows: [], shop, shopBoats: [], st })).toBeNull();
  });

  it("adds the requests up and names each one", () => {
    const plan = builderRequestPlan({
      requestRows: [
        request({}),
        request({ id: "r2", name: null, partySize: null, courseTitle: "Rescue" }),
      ] as Input["requestRows"],
      shop,
      shopBoats: [{ id: "b1", name: "Reef Runner", capacity: 12 }] as Input["shopBoats"],
      st,
    });
    expect(plan?.estimatedDivers).toBe(5);
    expect(plan?.requests.map((row) => row.name)).toEqual(["Tomás", st("requests.anonymous")]);
    expect(plan?.requests[1]?.subject).toBe(st("requests.aboutCourse", { course: "Rescue" }));
    expect(plan?.requests[1]?.divers).toBe(1);
    expect(plan?.diversPerDivemaster).toBe(6);
  });

  it("tells a shop with no crew schedule nothing about crewing", () => {
    const plan = builderRequestPlan({
      requestRows: [request({ partySize: 20 })] as Input["requestRows"],
      shop: { ...shop, crewScheduleEnabled: false } as Input["shop"],
      shopBoats: [],
      st,
    });
    expect(plan?.suggestedDivemasters).toBe(0);
  });
});
