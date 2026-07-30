import { describe, expect, it } from "vitest";
import { birthdayText } from "./birthday-labels";
import { staffTranslator } from "./staff-messages";

const t = staffTranslator("en-US");

describe("birthdayText", () => {
  it("says 'today' on the day itself", () => {
    expect(birthdayText(t, { status: "today" })).toBe("today");
  });

  it("counts forward", () => {
    expect(birthdayText(t, { status: "soon", inDays: 1 })).toBe("in 1d");
    expect(birthdayText(t, { status: "soon", inDays: 7 })).toBe("in 7d");
  });

  it("counts back", () => {
    expect(birthdayText(t, { status: "recent", daysAgo: 2 })).toBe("2d ago");
  });

  it("is timing only — the 🎂 beside it carries the meaning", () => {
    // Guards the copy decision: no age, no name, no sentence, so the string
    // stays short enough for a badge on an already-dense roster row.
    for (const text of [
      birthdayText(t, { status: "today" }),
      birthdayText(t, { status: "soon", inDays: 3 }),
      birthdayText(t, { status: "recent", daysAgo: 3 }),
    ]) {
      expect(text.length).toBeLessThanOrEqual(8);
      expect(text).not.toMatch(/turns|birthday/i);
    }
  });
});
