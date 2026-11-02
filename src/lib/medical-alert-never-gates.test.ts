import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **The medical alert for the crew never gates** (glossary *Medical alert for
 * the crew*, H-20261023-medical-alert-for-the; domain review 1, S7), held by the source rather than by
 * one fixture's words. No module that decides readiness, admission, roll-call
 * readiness or medical review may import or read the alert. Equality tests
 * catch a gate only if it fires on the fixture's text; this catches any read.
 */
const GATES = [
  "src/lib/readiness.ts",
  "src/lib/readiness-summary.ts",
  "src/lib/roll-call-readiness.ts",
  "src/lib/trip-admission.ts",
  "src/lib/trip-admission-gate.ts",
  "src/lib/medical.ts",
  "src/lib/referrals.ts",
  "src/db/readiness.ts",
  "src/db/waivers-medical.ts",
];

/** `medicalAlert`, `draftMedicalAlert`, `medical_alert`, or the module itself. */
const READS_THE_ALERT = /medicalAlert|MedicalAlert|medical_alert|medical-alert/;

describe("the medical alert for the crew never gates", () => {
  it.each(GATES)("%s neither imports nor reads it", (file) => {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    const lines = source
      .split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => READS_THE_ALERT.test(line))
      .map(({ line, number }) => `${file}:${number}: ${line.trim()}`);
    expect(lines).toEqual([]);
  });
});
