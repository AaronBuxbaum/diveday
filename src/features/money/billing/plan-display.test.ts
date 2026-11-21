import { describe, expect, it } from "vitest";
import { planCopyParams, planMoney, planPercent } from "./plan-display";

describe("plan figures", () => {
  it("renders today's price as the published figure in every locale", () => {
    expect(planMoney(9_900, "en-US")).toBe("$99");
    expect(planMoney(9_900, "es-ES")).toBe("$99");
  });

  it("formats any other amount in the reader's locale", () => {
    expect(planMoney(12_900, "en-US")).toBe("$129");
    expect(planMoney(2_950, "en-US")).toBe("$29.50");
  });

  it("formats basis points as a percentage", () => {
    expect(planPercent(300, "en-US")).toBe("3%");
    expect(planPercent(250, "en-US")).toBe("2.5%");
    expect(planPercent(300, "es-ES")).toMatch(/^3\s?%$/);
  });

  it("says whether the percent plan carries a base fee", () => {
    expect(
      planCopyParams({ plan: "percent_of_volume", monthlyCents: 0, basisPoints: 300 }, "en-US"),
    ).toMatchObject({ percent: "3%", hasBase: "no" });
    expect(
      planCopyParams({ plan: "percent_of_volume", monthlyCents: 2_900, basisPoints: 300 }, "en-US"),
    ).toMatchObject({ base: "$29", hasBase: "yes" });
  });
});
