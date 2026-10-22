import { describe, expect, it } from "vitest";
import { reviewPlan } from "./visual-review.mjs";

describe("scoped review policy", () => {
  it("requires a scope and a positive changed-state contract for captures", () => {
    expect(() => reviewPlan([])).toThrow("--grep");
    expect(() => reviewPlan(["--grep", "invoice"])).toThrow("--expect");
  });
  it("plans without a build or browser and never claims review", () => {
    const result = reviewPlan(["--grep", "invoice", "--plan"]);
    expect(result.review).toBe("not-reviewed");
    expect(result.captureArgs).toContain("(?=.*light mode)(?=.*(?:invoice))");
    expect(result.omitted[0]).toContain("dark");
  });
  it("color work opts into both existing scheme matrices", () => {
    expect(reviewPlan(["--grep", "invoice", "--plan", "--color"]).captureArgs).toContain("invoice");
  });
  it("preserves operator regex syntax as one Playwright argv value", () => {
    const grep = "^(invoice|rental)$";
    const plan = reviewPlan(["--grep", grep, "--plan", "--color"]);
    expect(plan.captureArgs[plan.captureArgs.indexOf("--grep") + 1]).toBe(grep);
    const pattern = new RegExp(grep);
    expect(pattern.test("invoice")).toBe(true);
    expect(pattern.test("rental")).toBe(true);
    expect(pattern.test("invoice draft")).toBe(false);
    expect(() => reviewPlan(["--grep", "[", "--plan"])).toThrow(SyntaxError);
  });
});
