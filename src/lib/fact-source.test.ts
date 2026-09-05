import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FACT_SOURCES, factSourceFromChangeEvent } from "./fact-source";

describe("the four sources", () => {
  it("are exactly Forecast, Plan, Crew and Observed, in the Budget's own order", () => {
    // The order is the rule's, and the chip, the label map and the tests all
    // read it from here — so a fifth source cannot arrive without this line
    // moving and the ADR being reopened.
    expect(FACT_SOURCES).toEqual(["forecast", "plan", "crew", "observed"]);
  });
});

describe("factSourceFromChangeEvent", () => {
  it("reads a shop edit as the plan and a crew change as the crew", () => {
    expect(factSourceFromChangeEvent("shop")).toBe("plan");
    expect(factSourceFromChangeEvent("crew")).toBe("crew");
  });

  it("never produces observed", () => {
    // Budget rule 5's floor: only Observed may print on a recap as what
    // happened, so nothing that merely records an *edit* may map to it.
    const produced = (["shop", "crew"] as const).map(factSourceFromChangeEvent);
    expect(produced).not.toContain("observed");
    expect(produced).not.toContain("forecast");
  });
});

describe("codes, not sentences", () => {
  it("holds no word a reader would see", () => {
    // The repo's standing rule for `src/lib` (AGENTS.md): the words live in
    // src/i18n/fact-source-labels.ts, in every locale. Docblocks quote the ADR
    // and are stripped before the sweep; what is left is code.
    const source = readFileSync(join(__dirname, "fact-source.ts"), "utf8");
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const word of ["Forecast", "Plan", "Crew", "Observed"]) {
      expect(code).not.toContain(word);
    }
  });
});
