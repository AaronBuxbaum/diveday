import { describe, expect, it } from "vitest";
import { rollCallLabel } from "@/lib/manifests";
import { rollCallCheckpointText, rollCallLabelText } from "./manifest-labels";
import { staffTranslator } from "./staff-messages";

const t = staffTranslator("en-US");
const es = staffTranslator("es-ES");

describe("rollCallCheckpointText", () => {
  it("reads the departure checkpoint", () => {
    expect(rollCallCheckpointText(t, "departure")).toBe("Before departure");
  });

  it("reads an after-dive checkpoint with its dive number", () => {
    expect(rollCallCheckpointText(t, "after_dive_1")).toBe("After dive 1");
    expect(rollCallCheckpointText(t, "after_dive_2")).toBe("After dive 2");
  });
});

/**
 * DOM-H3. The lib layer hands back a code and this is the only place the words
 * are chosen, so the live manifest and the offline copy cannot describe the
 * same diver differently.
 */
describe("rollCallLabelText", () => {
  it("words every roll-call state", () => {
    expect(rollCallLabelText(t, "awaiting")).toBe("Awaiting roll call");
    expect(rollCallLabelText(t, "boarded")).toBe("Boarded");
    expect(rollCallLabelText(t, "not_boarded")).toBe("Not boarded");
    expect(rollCallLabelText(t, "not_boarded_carried")).toBe("Not boarded · carried");
    expect(rollCallLabelText(t, "not_back_aboard")).toBe("Not back aboard");
    expect(rollCallLabelText(es, "not_back_aboard")).toBe("Sin regresar a bordo");
  });

  it("never puts a settled done-check beside a diver who has not returned", () => {
    const missing = {
      state: "not_boarded" as const,
      occurredAt: new Date("2026-07-20T13:45:00.000Z"),
      recordedByName: "Dana Reyes",
      note: null,
    };
    for (const translator of [t, es]) {
      const words = rollCallLabelText(translator, rollCallLabel("after_dive_1", missing));
      expect(words).not.toContain("✓");
      expect(words).not.toBe(rollCallLabelText(translator, rollCallLabel("departure", missing)));
    }
  });
});
