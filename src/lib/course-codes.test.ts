import { describe, expect, it } from "vitest";
import {
  MAX_ELEARNING_CODE_LENGTH,
  MAX_ELEARNING_CODES_PER_PASTE,
  parseElearningCodes,
} from "./course-codes";

describe("parseElearningCodes", () => {
  it("reads lines, commas, semicolons and spaces", () => {
    expect(parseElearningCodes("AB12\nCD34, EF56;GH78  IJ90\r\n")).toEqual({
      ok: true,
      codes: ["AB12", "CD34", "EF56", "GH78", "IJ90"],
      repeated: 0,
    });
  });

  it("keeps case and counts a repeat once", () => {
    expect(parseElearningCodes("abC1 abC1 ABC1")).toEqual({
      ok: true,
      codes: ["abC1", "ABC1"],
      repeated: 1,
    });
  });

  it("reads an empty box as no codes", () => {
    expect(parseElearningCodes("  \n ")).toEqual({ ok: true, codes: [], repeated: 0 });
  });

  it("refuses a code longer than any agency issues", () => {
    expect(parseElearningCodes("x".repeat(MAX_ELEARNING_CODE_LENGTH + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("refuses a paste of more codes than one order holds", () => {
    const many = Array.from({ length: MAX_ELEARNING_CODES_PER_PASTE + 1 }, (_, i) => `C${i}`);
    expect(parseElearningCodes(many.join("\n"))).toEqual({ ok: false, reason: "too_many" });
  });
});
