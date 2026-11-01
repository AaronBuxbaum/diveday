import { describe, expect, it } from "vitest";

import { parseNameStatus, untestedLogicWarning } from "./warn-untested-logic.mjs";

const diff = (...lines) => lines.join("\n");

describe("warn-untested-logic", () => {
  it("warns when logic changes and no test file does", () => {
    const changes = parseNameStatus(diff("M\tsrc/lib/pricing.ts", "A\tsrc/db/refunds-new.ts"));
    const warning = untestedLogicWarning(changes);
    expect(warning).toMatch(/^::warning title=Logic changed with no test::/);
    expect(warning).toContain("src/lib/pricing.ts");
    expect(warning).toContain("src/db/refunds-new.ts");
  });

  it("covers src/features too", () => {
    expect(untestedLogicWarning(parseNameStatus("M\tsrc/features/trips/plan.ts"))).toMatch(
      /^::warning/,
    );
  });

  it("is quiet when any test file changes, whatever it sits next to", () => {
    const changes = parseNameStatus(diff("M\tsrc/lib/pricing.ts", "M\tsrc/lib/other.test.ts"));
    expect(untestedLogicWarning(changes)).toBeNull();
    const e2e = parseNameStatus(diff("M\tsrc/db/trips.ts", "A\te2e/trips.test.mjs"));
    expect(untestedLogicWarning(e2e)).toBeNull();
  });

  it("does not count a rename or a pure deletion as a change", () => {
    const changes = parseNameStatus(
      diff("R100\tsrc/lib/old-name.ts\tsrc/lib/new-name.ts", "D\tsrc/db/dead.ts"),
    );
    expect(untestedLogicWarning(changes)).toBeNull();
  });

  it("treats a rename with edits as a rename", () => {
    expect(untestedLogicWarning(parseNameStatus("R087\tsrc/lib/a.ts\tsrc/lib/b.ts"))).toBeNull();
  });

  it("leaves other files alone", () => {
    const changes = parseNameStatus(
      diff(
        "M\tsrc/app/shop/page.tsx",
        "M\tsrc/lib/button.tsx",
        "M\tsrc/lib/types.d.ts",
        "M\tsrc/i18n/locales/en-US/diver.json",
        "M\tscripts/check-adrs.mjs",
        "M\tdocs/README.md",
      ),
    );
    expect(untestedLogicWarning(changes)).toBeNull();
  });

  it("lists at most ten files and counts the rest", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `M\tsrc/lib/f${i}.ts`);
    const warning = untestedLogicWarning(parseNameStatus(lines.join("\n")));
    expect(warning).toContain("src/lib/f9.ts");
    expect(warning).not.toContain("src/lib/f10.ts");
    expect(warning).toContain("and 2 more");
  });

  it("keeps the annotation on one line", () => {
    const warning = untestedLogicWarning(parseNameStatus("M\tsrc/lib/a.ts"));
    expect(warning.split("\n")).toHaveLength(1);
  });
});
