import { describe, expect, it } from "vitest";
import { agentSteps, browserPlan } from "./verify-agent-plan.mjs";

const selection = (fallbacks = []) => ({
  strong: new Map([
    ["smoke:4", new Set(["smoke"])],
    ["edited", new Set(["edited"])],
  ]),
  reach: new Map([
    ["near", new Set()],
    ["far", new Set()],
  ]),
  rank: new Map([
    ["near", 0],
    ["far", 1],
  ]),
  fallbacks,
});
describe("fast agent plan", () => {
  it("never budgets out strong tests and explicitly records deferred reach", () => {
    const plan = browserPlan({
      selection: selection(),
      record: { near: 20, far: 30 },
      budgetMs: 20,
    });
    expect(plan.specs).toEqual(["edited", "near", "smoke:4"]);
    expect(plan.deferred).toEqual(["far"]);
  });
  it("ignores the budget on conservative fallback", () => {
    const plan = browserPlan({ selection: selection(["schema"]), budgetMs: 0 });
    expect(plan.deferred).toEqual([]);
    expect(plan.specs).toContain("far");
  });
  it("refuses unknown diff bases and invalid budgets", () => {
    expect(() => browserPlan({ selection: null })).toThrow(/base/);
    expect(() => browserPlan({ selection: selection(), budgetMs: Number.NaN })).toThrow(/budget/);
  });
  it("always runs safeguards but skips empty unit/browser selections", () => {
    const steps = agentSteps({ units: { mode: "direct", files: [] }, browser: { specs: [] } });
    expect(steps.map((step) => step.name)).toEqual([
      "lint",
      "typecheck",
      "repository safeguards",
      "guard tests",
    ]);
    expect(steps.some((step) => step.args.includes("regen"))).toBe(false);
  });
  it("builds before browser tests and retains full-unit fallback", () => {
    const steps = agentSteps({
      units: { mode: "all", files: [] },
      browser: { specs: ["e2e/auth.spec.ts"] },
    });
    expect(steps.at(-2).name).toBe("browser build");
    expect(steps.at(-1).args).toContain("e2e/auth.spec.ts");
    expect(steps.some((step) => step.name === "affected units")).toBe(true);
  });
});
