import { describe, expect, it } from "vitest";
import { canReceiveText, homeNumberingArea } from "./phone-line-type";

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

/**
 * **The `+1` refusal boundary** (issues #2151, #3249). The gate asks the
 * metadata which country a number is in; each case below is a way a stranger
 * could aim the shop's sender at a number the shop would pay premium rates for.
 */
describe("homeNumberingArea", () => {
  it("reads home, another calling code, and another +1 country apart", () => {
    expect(homeNumberingArea("+13055550110", "US")).toBe("home");
    expect(homeNumberingArea("+18765550110", "US")).toBe("foreign_area_code");
    expect(homeNumberingArea("+447700900123", "US")).toBe("foreign_code");
    expect(homeNumberingArea("+34612345678", "ES")).toBe("home");
  });

  it("refuses Caribbean and Pacific +1 territories for a US shop", () => {
    for (const number of [
      "+18765550110", // Jamaica
      "+18095550110", // Dominican Republic
      "+18295550110",
      "+18495550110",
      "+17875550110", // Puerto Rico
      "+16715550110", // Guam
      "+13405550110", // US Virgin Islands
    ]) {
      expect(homeNumberingArea(number, "US"), number).toBe("foreign_area_code");
    }
  });

  it("refuses premium, toll-free and personal +1 ranges for every +1 shop", () => {
    for (const area of [
      "900",
      "976",
      "800",
      "833",
      "844",
      "855",
      "866",
      "877",
      "888",
      "500",
      "533",
      "544",
    ]) {
      for (const shop of ["US", "CA", "JM", "BS"]) {
        expect(homeNumberingArea(`+1${area}5551234`, shop), `${area} ${shop}`).toBe(
          "foreign_area_code",
        );
      }
    }
  });

  it("refuses an unassigned area code and a malformed length", () => {
    expect(homeNumberingArea("+12005550110", "US")).toBe("foreign_area_code");
    expect(homeNumberingArea("+10005550110", "US")).toBe("foreign_area_code");
    expect(homeNumberingArea("+1305555011", "US")).toBe("foreign_area_code");
    expect(homeNumberingArea("+130555501101", "US")).toBe("foreign_area_code");
    expect(homeNumberingArea("+1", "US")).toBe("foreign_area_code");
  });

  it("tells the US from Canada in both directions", () => {
    expect(homeNumberingArea("+14165550110", "CA")).toBe("home");
    expect(homeNumberingArea("+16045550110", "CA")).toBe("home");
    expect(homeNumberingArea("+14165550110", "US")).toBe("foreign_area_code");
    expect(homeNumberingArea("+13055550110", "CA")).toBe("foreign_area_code");
  });

  it("takes a Caribbean shop's own island and nobody else's", () => {
    expect(homeNumberingArea("+18765550110", "JM")).toBe("home");
    expect(homeNumberingArea("+18095550110", "DO")).toBe("home");
    expect(homeNumberingArea("+18095550110", "JM")).toBe("foreign_area_code");
    expect(homeNumberingArea("+13055550110", "JM")).toBe("foreign_area_code");
  });

  it("refuses a +1 number for a shop with no country or one it has no code for", () => {
    expect(homeNumberingArea("+13055550110", null)).toBe("foreign_code");
    expect(homeNumberingArea("+13055550110", "JP")).toBe("foreign_code");
  });

  it("takes newly assigned prefixes the old hand-kept table refused (Aaron, 2026-10-31)", () => {
    expect(homeNumberingArea("+17385550110", "US")).toBe("home");
    expect(homeNumberingArea("+17485550110", "US")).toBe("home");
    expect(homeNumberingArea("+12735550110", "CA")).toBe("home");
  });
});
