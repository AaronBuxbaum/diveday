import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CERTIFICATION_LEVELS,
  REQUIRABLE_CERTIFICATION_LEVELS,
  type RequirableCertificationLevel,
} from "./certification-levels";
import { REQUIRABLE_CERTIFICATION_LEVELS as VIA_READINESS } from "./readiness";

/**
 * **This module's job is to import nothing** (issue #1354). A single import
 * would pull `readiness.ts`, and the waiver and medical copy behind it, into
 * the first load of the public diver pages. It is a test because the edge has
 * been cut before and grew back (issue #718, a `node:crypto` chain), and the
 * failure is bytes on a page rather than a broken feature.
 */
describe("the certification ladder leaf", () => {
  it("imports nothing at all", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/certification-levels.ts"),
      "utf8",
    );
    const imports = [...source.matchAll(/^\s*import[\s{*]/gm)];
    expect(
      imports.map((match) => match[0].trim()),
      "src/lib/certification-levels.ts must import nothing — see its docblock and issue #718",
    ).toEqual([]);
  });

  it("is the same list `readiness.ts` hands its callers", () => {
    // The re-export is what keeps every existing caller unchanged, so a
    // divergence here would be a second, silently different ladder.
    expect(VIA_READINESS).toBe(REQUIRABLE_CERTIFICATION_LEVELS);
  });

  it("keeps the full ordered ladder separate from the requirable subset", () => {
    expect(CERTIFICATION_LEVELS).toEqual([
      "open_water",
      "advanced_open_water",
      "rescue",
      "divemaster",
      "instructor",
    ]);
    expect(REQUIRABLE_CERTIFICATION_LEVELS).toEqual(CERTIFICATION_LEVELS.slice(0, 3));
  });

  it("stops at rescue, and never offers a working rating", () => {
    // The domain rule the list exists for (issue #630): a shop may demand a
    // recreational rung of a paying diver, never a professional one.
    expect([...REQUIRABLE_CERTIFICATION_LEVELS]).toEqual([
      "open_water",
      "advanced_open_water",
      "rescue",
    ]);
    const professional: string[] = ["divemaster", "instructor"];
    for (const level of REQUIRABLE_CERTIFICATION_LEVELS as readonly RequirableCertificationLevel[]) {
      expect(professional).not.toContain(level);
    }
  });
});
