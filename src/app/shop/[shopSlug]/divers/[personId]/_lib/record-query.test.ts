import { describe, expect, it } from "vitest";
import { bookingPageNumber } from "./record-query";

describe("booking picker URL pages", () => {
  it("accepts whole positive pages", () => {
    expect(bookingPageNumber("2")).toBe(2);
    expect(bookingPageNumber("999")).toBe(999);
  });

  it.each([
    undefined,
    "",
    "0",
    "-1",
    "2.5",
    "2oops",
    "Infinity",
    "9999999999999999999999999999999999999999",
    ["2", "3"],
  ])("treats an invalid or unsafe page %j as the first page", (value) => {
    expect(bookingPageNumber(value)).toBe(1);
  });
});
