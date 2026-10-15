import { describe, expect, it } from "vitest";
import { buildsRawSlugLocation, redirectSlugProblems } from "./check-redirect-slugs.mjs";

describe("buildsRawSlugLocation", () => {
  it("refuses a Location template that interpolates the bare slug", () => {
    expect(
      buildsRawSlugLocation("headers: { Location: `/shop/${shopSlug}/waivers?notice=x` },"),
    ).toBe(true);
  });

  it("passes a Location built through shopPath, and one only named in a comment", () => {
    expect(buildsRawSlugLocation('headers: { Location: shopPath(shopSlug, "waivers") },')).toBe(
      false,
    );
    expect(buildsRawSlugLocation("// Location: `/shop/${shopSlug}` was the old shape\n")).toBe(
      false,
    );
  });
});

describe("the staff handlers as they stand", () => {
  it("build every Location through shopPath", async () => {
    expect((await redirectSlugProblems()).problems).toEqual([]);
  });
});
