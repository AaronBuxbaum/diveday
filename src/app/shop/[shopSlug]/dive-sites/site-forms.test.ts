import { describe, expect, it } from "vitest";
import { siteFormExtras } from "./site-forms";

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

describe("siteFormExtras (security review of issue 2233)", () => {
  it("reads the nitrox box and the version the tab last saw", () => {
    expect(
      siteFormExtras(
        form([
          ["requiresNitrox", "on"],
          ["expectedVersion", "4"],
        ]),
      ),
    ).toEqual({
      requiresNitrox: true,
      expectedVersion: 4,
    });
    expect(siteFormExtras(form([]))).toEqual({ requiresNitrox: false, expectedVersion: null });
  });

  /**
   * The nitrox flag gates who may book the site, so a form that does not read
   * is refused rather than saved as "no nitrox" over the shop's own answer.
   */
  it("refuses a form whose nitrox box or version does not read, rather than defaulting", () => {
    expect(
      siteFormExtras(
        form([
          ["requiresNitrox", "on"],
          ["requiresNitrox", "on"],
        ]),
      ),
    ).toBeNull();
    expect(
      siteFormExtras(
        form([
          ["expectedVersion", "1"],
          ["expectedVersion", "2"],
        ]),
      ),
    ).toBeNull();
  });
});
