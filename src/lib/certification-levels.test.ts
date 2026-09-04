import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  REQUIRABLE_CERTIFICATION_LEVELS,
  type RequirableCertificationLevel,
} from "./certification-levels";
import { REQUIRABLE_CERTIFICATION_LEVELS as VIA_READINESS } from "./readiness";

/**
 * **This module's job is to import nothing** (issue #1354).
 *
 * `src/i18n/readiness-labels.ts` needs one value from the readiness side of the
 * app, and taking it from `readiness.ts` put that whole module — and the waiver
 * and medical copy behind it — into the first load of `/s/[shopSlug]` and
 * `/s/[shopSlug]/trips/[id]`, the two public, anonymous diver pages.
 *
 * The reason this is a test and not a comment is that **the edge has been cut
 * before and grew back.** Issue #718 found it carrying `node:crypto` and a
 * `crypto-browserify` chain whose `vm-browserify` is a literal `eval` — the
 * only CSP violation the report-only pass produced. That fix moved the crypto
 * out of the tail and left the edge standing, so the next thing to grow down it
 * (copy, this time) arrived unannounced years of commits later.
 *
 * A single import here re-opens it. Nothing else in the repository would say
 * so, because the failure is bytes on a page rather than a broken feature.
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
