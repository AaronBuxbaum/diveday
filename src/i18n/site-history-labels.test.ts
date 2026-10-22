import { describe, expect, it } from "vitest";
import type { SiteHistory } from "@/lib/site-history";
import { siteHistoryText } from "./site-history-labels";
import { staffTranslator } from "./staff-messages";

const NOW = new Date("2026-10-15T16:00:00Z");
const ZONE = "America/New_York";

const last = (overrides: Partial<SiteHistory> = {}): SiteHistory =>
  ({
    kind: "dived",
    divedAt: new Date("2026-10-12T14:00:00Z"),
    recordedByName: "Sal Moretti",
    visibility: "40 ft",
    current: "light, to the north",
    actualSiteName: "Molasses",
    ...overrides,
  }) as SiteHistory;

const say = (history: SiteHistory, locale = "en-US") =>
  siteHistoryText(staffTranslator(locale), {
    site: "Molasses",
    history,
    locale,
    timeZone: ZONE,
    now: NOW,
  }).replace(/\s/g, " ");

describe("siteHistoryText", () => {
  it("says who dived it last and what they saw, in their words", () => {
    expect(say(last())).toBe(
      "Molasses: last dived Mon, Oct 12 (Sal Moretti): visibility 40 ft, current light, to the north",
    );
    expect(say(last({ current: null, recordedByName: null }))).toBe(
      "Molasses: last dived Mon, Oct 12: visibility 40 ft",
    );
    expect(say(last({ visibility: null, current: null }))).toBe(
      "Molasses: last dived Mon, Oct 12 (Sal Moretti)",
    );
  });

  it("says where the boat went instead when the site was planned and moved", () => {
    expect(say(last({ kind: "moved", actualSiteName: "French Reef" }))).toBe(
      "Molasses: moved to French Reef last time (Mon, Oct 12)",
    );
  });

  it("names the year once the visit is more than half a year back", () => {
    expect(
      say(last({ divedAt: new Date("2025-11-02T14:00:00Z"), visibility: null, current: null })),
    ).toMatch(/2025/);
  });

  it("speaks Spanish", () => {
    expect(say(last({ kind: "moved", actualSiteName: "French Reef" }), "es-ES")).toMatch(
      /^Molasses: la última vez se cambió a French Reef/,
    );
  });
});
