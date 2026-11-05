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
    charter: false,
    ...over,
  };
}

describe("builderRequestPlan", () => {
  it("is null when the link carried no requests", () => {
    expect(
      builderRequestPlan({ requestRows: [], shop, shopBoats: [], st, locale: "en-US" }),
    ).toBeNull();
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
      locale: "en-US",
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
      locale: "en-US",
    });
    expect(plan?.suggestedDivemasters).toBe(0);
  });

  it("says before Add that a whole-boat request makes the departure private (loop 5, row 11)", () => {
    const plan = builderRequestPlan({
      requestRows: [request({ charter: true })] as Input["requestRows"],
      shop,
      shopBoats: [],
      st,
      locale: "en-US",
    });
    expect(plan?.requests[0]?.subject).toBe(
      "Wants the whole boat: two-tank. This departure will be private.",
    );
  });

  it("shows the whole-boat quote beside the price, and sets nothing from it", () => {
    const plan = builderRequestPlan({
      requestRows: [
        request({ charter: true, charterQuoteCents: 180000, charterQuoteCurrency: "usd" }),
        request({ id: "r2", charter: true }),
        request({ id: "r3" }),
      ] as Input["requestRows"],
      shop,
      shopBoats: [],
      st,
      locale: "en-US",
    });
    expect(plan?.requests.map((row) => row.quote)).toEqual([
      "Quoted $1,800 for the whole boat. The price is set separately.",
      null,
      null,
    ]);
  });

  it("words the quote in the shop's language and currency", () => {
    const plan = builderRequestPlan({
      requestRows: [
        request({ charter: true, charterQuoteCents: 180000, charterQuoteCurrency: "eur" }),
      ] as Input["requestRows"],
      shop,
      shopBoats: [],
      st: staffTranslator("es-ES"),
      locale: "es-ES",
    });
    expect(plan?.requests[0]?.quote).toMatch(/^Presupuesto de 1.?800\s€ por el barco entero\./);
  });
});
