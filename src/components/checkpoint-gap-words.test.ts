import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { checkpointGapLine } from "./checkpoint-gap-words";

const en = staffTranslator("en-US");
const es = staffTranslator("es-ES");

const unmarked = (divers: number, crew: number, missing: number) =>
  ({ kind: "unmarked", checkpoint: "after_dive_2", divers, crew, missing }) as const;

/**
 * A person recorded not back aboard has been marked: they are the missing
 * diver, and the line says so apart from those nobody has marked yet
 * (dive-domain review, 2026-10-16).
 */
describe("checkpointGapLine", () => {
  it("words people nobody marked as not marked", () => {
    expect(checkpointGapLine(en, unmarked(2, 0, 0))).toBe("2 people not marked after dive 2.");
    expect(checkpointGapLine(en, unmarked(11, 1, 0))).toBe(
      "11 passengers and 1 crew not marked after dive 2.",
    );
  });

  it("words people marked not back aboard on their own", () => {
    expect(checkpointGapLine(en, unmarked(0, 0, 1))).toBe("1 person not back aboard after dive 2.");
    expect(checkpointGapLine(en, unmarked(2, 0, 1))).toBe(
      "2 people not marked after dive 2. 1 more is not back aboard.",
    );
    expect(checkpointGapLine(en, unmarked(0, 1, 2))).toBe(
      "1 crew not marked after dive 2. 2 more are not back aboard.",
    );
  });

  it("has the Spanish for both", () => {
    expect(checkpointGapLine(es, unmarked(0, 0, 2))).toBe(
      "2 personas no han vuelto a bordo después de la inmersión 2.",
    );
    expect(checkpointGapLine(es, unmarked(1, 0, 1))).toBe(
      "1 persona sin marcar después de la inmersión 2. 1 persona más no ha vuelto a bordo.",
    );
  });
});
