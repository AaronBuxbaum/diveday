import { describe, expect, it } from "vitest";
import { buttonClass } from "./button";

describe("a flush link", () => {
  it("starts its wrapped lines where its first line starts", () => {
    // A flush link lines up with the prose beside it, so it reads as text: a
    // wrapped "On the board …" line on Requests at 390 sat centred under
    // nothing (visual review 2026-10-24, layer 7).
    for (const flush of [true, "padded"] as const) {
      const classes = buttonClass({ variant: "link", flush }).split(" ");
      expect(classes).toEqual(expect.arrayContaining(["justify-start", "text-start"]));
      expect(classes).not.toContain("justify-center");
      expect(classes).not.toContain("text-center");
    }
    // A link that is not flush, and a flush square, stay centred controls.
    expect(buttonClass({ variant: "link" }).split(" ")).toContain("text-center");
    expect(buttonClass({ variant: "link", size: "icon", flush: true }).split(" ")).toContain(
      "text-center",
    );
  });
});
