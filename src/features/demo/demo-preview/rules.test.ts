import { describe, expect, it } from "vitest";
import { DEMO_SHOP_BRAND } from "../../../db/seed/shop-brand";
import {
  PREVIEW_TTL_MS,
  parseDepartureTime,
  parseDepartureTimes,
  parsePreviewInput,
  previewIdFrom,
  previewIsOpen,
} from "./rules";

/** Any real brand colour; the canonical demo's own, so no hex is typed here. */
const BLUE = DEMO_SHOP_BRAND.brandColor as string;

describe("previewIdFrom", () => {
  it("accepts a row id in either case and nothing else", () => {
    expect(previewIdFrom("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe(
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    );
    for (const junk of [undefined, null, 7, "", "blue-mantis", "3f2504e0", "../shop/x"]) {
      expect(previewIdFrom(junk)).toBeNull();
    }
  });
});

describe("parsePreviewInput", () => {
  it("keeps a name alone, with everything else left as the demo has it", () => {
    expect(parsePreviewInput({ name: "  Reef Line Divers " })).toEqual({
      ok: true,
      input: {
        name: "Reef Line Divers",
        site: null,
        brandColor: null,
        tagline: null,
        locality: null,
        region: null,
        position: null,
        departureTimes: [],
        boatNames: [],
      },
    });
  });

  it("normalizes the colour and keeps a whole position", () => {
    const parsed = parsePreviewInput({
      name: "Reef Line Divers",
      site: "https://reefline.example",
      brandColor: BLUE.slice(1).toUpperCase(),
      locality: "Key Largo",
      region: "FL",
      latitude: 25.08,
      longitude: -80.44,
    });
    expect(parsed.ok && parsed.input.brandColor).toBe(BLUE);
    expect(parsed.ok && parsed.input.position).toEqual({ latitude: 25.08, longitude: -80.44 });
  });

  it("drops half a position", () => {
    const parsed = parsePreviewInput({ name: "Reef Line Divers", latitude: 25.08 });
    expect(parsed.ok && parsed.input.position).toBeNull();
  });

  it("refuses a colour that is not one, so a typo is seen before the email", () => {
    expect(parsePreviewInput({ name: "Reef Line Divers", brandColor: "teal" })).toEqual({
      ok: false,
      error: "invalid_color",
    });
  });

  it("refuses a missing name and a site that is not a web address", () => {
    expect(parsePreviewInput({})).toEqual({ ok: false, error: "invalid" });
    expect(parsePreviewInput({ name: "Reef", site: "javascript:alert(1)" })).toEqual({
      ok: false,
      error: "invalid",
    });
  });
});

describe("departure times", () => {
  it("reads a time the way the founder types it or the site reader writes it", () => {
    expect(parseDepartureTime("8:30 AM")).toBe("08:30");
    expect(parseDepartureTime("1 pm")).toBe("13:00");
    expect(parseDepartureTime("12:15 p.m.")).toBe("12:15");
    expect(parseDepartureTime("13:00")).toBe("13:00");
    expect(parseDepartureTime("08:30")).toBe("08:30");
  });

  it("refuses what is not a boat's hour", () => {
    for (const junk of ["", "8", "noon", "13 pm", "25:00", "3:00 AM", "10:30 PM", "8:75"]) {
      expect(parseDepartureTime(junk), junk).toBeNull();
    }
  });

  it("reads a list, sorted and once each, and refuses it whole for one bad part", () => {
    expect(parseDepartureTimes("1:00 PM, 8:30 AM, 13:00")).toEqual(["08:30", "13:00"]);
    expect(parseDepartureTimes("8:30 AM, later")).toBeNull();
  });

  it("dresses a preview in times and boat names, and refuses a time that is not one", () => {
    const parsed = parsePreviewInput({
      name: "Reef Line Divers",
      departureTimes: ["13:00", "08:30"],
      boatNames: ["Reef Runner", "Sea Hunter"],
    });
    expect(parsed.ok && parsed.input).toMatchObject({
      departureTimes: ["08:30", "13:00"],
      boatNames: ["Reef Runner", "Sea Hunter"],
    });
    expect(parsePreviewInput({ name: "Reef", departureTimes: ["late"] })).toEqual({
      ok: false,
      error: "invalid_times",
    });
    expect(parsePreviewInput({ name: "Reef", boatNames: ["A", "B", "C"] })).toEqual({
      ok: false,
      error: "invalid",
    });
  });
});

describe("previewIsOpen", () => {
  it("is open until the week is up, and ended at that instant", () => {
    const created = new Date("2026-11-16T12:00:00.000Z");
    const expiresAt = new Date(created.getTime() + PREVIEW_TTL_MS);
    expect(previewIsOpen({ expiresAt }, new Date(expiresAt.getTime() - 1))).toBe(true);
    expect(previewIsOpen({ expiresAt }, expiresAt)).toBe(false);
  });
});
