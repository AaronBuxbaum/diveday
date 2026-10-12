import { describe, expect, it } from "vitest";

import { excerpt, plan, sourceScanTests } from "./verify-push.mjs";

const names = (steps) => steps.map((step) => step.name);
const base = { specs: [], scans: ["src/components/ui/form.test.tsx"] };

describe("the pre-push plan", () => {
  it("runs every local check CI's red jobs came from, cheapest first", () => {
    const steps = plan({ ...base, changed: ["src/lib/x.ts"], specs: ["e2e/a.spec.ts"] });
    expect(names(steps)).toEqual([
      "regen",
      "lint",
      "typecheck",
      "check:repo",
      "guards",
      "source scans",
      "related tests",
      "e2e build",
      "e2e specs",
    ]);
    expect(steps.find((s) => s.name === "related tests").args).toContain("src/lib/x.ts");
    expect(steps.at(-1).args).toContain("e2e/a.spec.ts");
  });

  it("names the schema guards instead of a --changed run that would be the whole suite", () => {
    const steps = plan({ ...base, changed: ["src/db/schema/trips.ts"] });
    expect(names(steps)).toContain("schema guards");
    expect(names(steps)).not.toContain("related tests");
  });

  it("regenerates the export snapshot only when seed, schema or export changed", () => {
    expect(plan({ ...base, changed: ["src/db/seed-trips.ts"] })[0].args).toEqual(["regen"]);
    expect(plan({ ...base, changed: ["src/lib/x.ts"] })[0].args).toEqual([
      "regen",
      "--no-snapshot",
    ]);
  });

  it("stops at the static checks for a docs-only diff, as CI does", () => {
    expect(names(plan({ ...base, changed: ["docs/agents/verifying.md", "AGENTS.md"] }))).toEqual([
      "regen",
      "lint",
      "typecheck",
      "check:repo",
      "guards",
    ]);
  });
});

describe("the related tests", () => {
  it("follow the changed code only, so a package.json edit does not select the whole suite", () => {
    const steps = plan({
      ...base,
      changed: ["package.json", "scripts/a.mjs", "scripts/gone.mjs"],
      existing: (f) => f !== "scripts/gone.mjs",
    });
    const related = steps.find((s) => s.name === "related tests");
    expect(related.args).toContain("scripts/a.mjs");
    expect(related.args).not.toContain("package.json");
    expect(related.args).not.toContain("scripts/gone.mjs");
  });
});

describe("the source scans", () => {
  it("include the tests that read files and that vitest --changed never selects", () => {
    const scans = sourceScanTests();
    for (const file of [
      "src/components/ui/form.test.tsx",
      "src/components/ui/button.test.ts",
      "src/components/account/EntryShell.test.tsx",
      "src/db/erasure-coverage.test.ts",
    ]) {
      expect(scans).toContain(file);
    }
  });
});

describe("a red step's excerpt", () => {
  it("shows the first failure even when the summary pushes it out of the tail", () => {
    const log = [
      "== check:a: ok ==",
      "== check:context-budget (check-context-budget.mjs): FAILED (exit 1) ==",
      "- AGENTS.md: over its budget",
      ...Array.from({ length: 60 }, (_, i) => `== check:${i}: ok ==`),
      "check:repo: one or more checks failed",
    ].join("\n");
    const shown = excerpt(log);
    expect(shown).toContain("context-budget");
    expect(shown).toContain("over its budget");
    expect(shown).toContain("one or more checks failed");
  });

  it("is only the tail when the failure is already in it", () => {
    expect(excerpt("a\nb\n FAIL src/x.test.ts\nTests 1 failed")).toBe(
      "a\nb\n FAIL src/x.test.ts\nTests 1 failed",
    );
  });
});
