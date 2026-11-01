import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **The reminder informs and never gates** (H-20261017-decompression-departure-reminds-crew). The three boarding rules
 * are read as source: none may name the flag or the predicate, so a later edit
 * cannot quietly turn the advisory into a blocker.
 */
const GATES = ["readiness.ts", "trip-admission.ts", "roll-call-readiness.ts"];

describe("the decompression card reminder", () => {
  it.each(GATES)("is not read by %s", (file) => {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    expect(source).not.toContain("exceedsNoDecoLimits");
    expect(source).not.toContain("decompression-reminder");
    expect(source).not.toContain("needsDecompressionCardReminder");
  });
});
