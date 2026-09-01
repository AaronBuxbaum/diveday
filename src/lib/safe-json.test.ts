import { describe, expect, it } from "vitest";
import { safeJson } from "./safe-json";

describe("safeJson", () => {
  it("parses well-formed JSON of any shape", () => {
    expect(safeJson('[1,"two",null]')).toEqual([1, "two", null]);
    expect(safeJson('{"slug":"barred-hamlet"}')).toEqual({ slug: "barred-hamlet" });
    expect(safeJson('"a string"')).toBe("a string");
    expect(safeJson("7")).toBe(7);
  });

  it("answers null for malformed input instead of throwing", () => {
    for (const raw of ["", "{", "[1,", "banana", "{'single': 1}", "undefined", "NaN"]) {
      expect(safeJson(raw)).toBeNull();
    }
  });

  it("answers null for the literal null, which fails every caller's shape check the same way", () => {
    expect(safeJson("null")).toBeNull();
  });
});
