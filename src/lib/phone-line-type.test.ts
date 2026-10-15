import { describe, expect, it } from "vitest";
import { canReceiveText } from "./phone-line-type";

/**
 * **Which home numbers can take a text the shop pays for** (issue #2289).
 * The country gate (`homeNumberingArea`) let a premium or landline range
 * inside a non-NANP home country count as home: UK 09, Spanish 80x and 90x.
 */
describe("canReceiveText", () => {
  it("takes a mobile number", () => {
    expect(canReceiveText("+447911123456")).toBe(true);
    expect(canReceiveText("+34612345678")).toBe(true);
    expect(canReceiveText("+61412345678")).toBe(true);
  });

  it("takes a NANP number, where a landline and a mobile share every range", () => {
    expect(canReceiveText("+13055550110")).toBe(true);
    expect(canReceiveText("+12125551234")).toBe(true);
  });

  it("refuses UK premium, toll-free and landline ranges", () => {
    expect(canReceiveText("+449098790000")).toBe(false);
    expect(canReceiveText("+448001111111")).toBe(false);
    expect(canReceiveText("+442071234567")).toBe(false);
  });

  it("refuses Spanish 80x and 90x ranges and landlines", () => {
    expect(canReceiveText("+34803000000")).toBe(false);
    expect(canReceiveText("+34901000000")).toBe(false);
    expect(canReceiveText("+34905000000")).toBe(false);
    expect(canReceiveText("+34912345678")).toBe(false);
  });

  it("refuses a +1 premium range the area-code list would also refuse", () => {
    expect(canReceiveText("+19005551234")).toBe(false);
  });

  it("refuses what it cannot read", () => {
    expect(canReceiveText("")).toBe(false);
    expect(canReceiveText("+44")).toBe(false);
    expect(canReceiveText("not a number")).toBe(false);
  });
});
