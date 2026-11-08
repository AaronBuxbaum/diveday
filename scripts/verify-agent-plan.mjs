// Compose existing unit and browser selectors; do not confuse a fast result with full CI.
import { estimateMs, withinBudget } from "./e2e-affected.mjs";
import { testArgs } from "./test-affected.mjs";

export const REACH_BUDGET_MS = 10 * 60_000;

/** Strong evidence and smoke are mandatory; the budget applies only to speculative reach. */
export function browserPlan({ selection, record = {}, budgetMs = REACH_BUDGET_MS }) {
  if (!selection) throw new Error("Cannot select tests without a trustworthy diff base");
  if (!Number.isFinite(budgetMs) || budgetMs < 0) throw new Error("Invalid browser budget");
  const fallbacks = selection.fallbacks ?? [];
  const strong = [...selection.strong.keys()];
  const { run, left } = withinBudget(
    selection.reach,
    selection.rank,
    record,
    fallbacks.length ? Number.POSITIVE_INFINITY : budgetMs,
  );
  const chosen = new Set([...strong, ...run]);
  const specs = [...chosen]
    .filter((spec) => !/:\d+$/.test(spec) || !chosen.has(spec.replace(/:\d+$/, "")))
    .sort();
  return { specs, deferred: left, fallbacks, estimatedMs: estimateMs(specs, record) };
}

/** No regen or clean-tree requirement: this verifies the bytes an agent is still editing. */
export function agentSteps({ units, browser }) {
  const steps = [
    { name: "lint", command: "pnpm", args: ["lint"] },
    { name: "typecheck", command: "pnpm", args: ["typecheck"] },
    { name: "repository safeguards", command: "node", args: ["scripts/check-repo.mjs"] },
    {
      name: "guard tests",
      command: "pnpm",
      args: ["exec", "vitest", "run", "--project", "guards", "--reporter=dot"],
    },
  ];
  if (units.mode === "all" || units.files.length)
    steps.push({ name: "affected units", command: "pnpm", args: testArgs(units) });
  if (browser.specs.length) {
    steps.push({ name: "browser build", command: "pnpm", args: ["e2e:build"] });
    // Keep each bounded invocation small without allowing a failed chunk to be skipped.
    for (let i = 0; i < browser.specs.length; i += 25)
      steps.push({
        name: `browser ${i / 25 + 1}`,
        command: "pnpm",
        args: ["e2e:run", ...browser.specs.slice(i, i + 25), "--reporter=line"],
        browser: true,
      });
  }
  return steps;
}
