import { describe, expect, it } from "vitest";
import { rollCallCheckpointText } from "./manifest-labels";
import { staffTranslator } from "./staff-messages";

const t = staffTranslator("en-US");

describe("rollCallCheckpointText", () => {
  it("reads the departure checkpoint", () => {
    expect(rollCallCheckpointText(t, "departure")).toBe("Before departure");
  });

  it("reads an after-dive checkpoint with its dive number", () => {
    expect(rollCallCheckpointText(t, "after_dive_1")).toBe("After dive 1");
    expect(rollCallCheckpointText(t, "after_dive_2")).toBe("After dive 2");
  });
});
