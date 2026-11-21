import { describe, expect, it } from "vitest";
import { renderLlmsTxt } from "./llms-txt";

const ORIGIN = "https://dive.day";
const SPECIALTIES = ["deep", "wreck", "night", "drysuit"];

describe("renderLlmsTxt", () => {
  it("opens with the title and summary the convention asks for", () => {
    const body = renderLlmsTxt({ origin: ORIGIN, shops: [], specialtyCodes: SPECIALTIES });
    expect(body.startsWith("# DiveDay\n\n> DiveDay is ")).toBe(true);
  });

  it("names every public URL shape and where availability lives", () => {
    const body = renderLlmsTxt({ origin: ORIGIN, shops: [], specialtyCodes: SPECIALTIES });
    expect(body).toContain("https://dive.day/s/<shop-slug>/availability.json");
    expect(body).toContain("https://dive.day/s/<shop-slug>/trips/<trip-id>");
    expect(body).toContain("https://dive.day/s/<shop-slug>/courses");
    expect(body).toMatch(/Bookings happen on this page and only here/);
  });

  it("spells the codes the availability document uses", () => {
    const body = renderLlmsTxt({ origin: ORIGIN, shops: [], specialtyCodes: SPECIALTIES });
    expect(body).toContain("open_water, advanced_open_water, rescue");
    expect(body).toContain("deep, wreck, night, drysuit");
  });

  it("lists each listed shop with its schedule and availability, and says so when there are none", () => {
    expect(renderLlmsTxt({ origin: ORIGIN, shops: [], specialtyCodes: SPECIALTIES })).toContain(
      "- None listed yet.",
    );
    const body = renderLlmsTxt({
      origin: ORIGIN,
      shops: [{ slug: "reef-line", name: "Reef Line Divers" }],
      specialtyCodes: SPECIALTIES,
    });
    expect(body).toContain(
      "- [Reef Line Divers](https://dive.day/s/reef-line) — availability: https://dive.day/s/reef-line/availability.json",
    );
    expect(body).not.toContain("None listed yet");
  });
});
