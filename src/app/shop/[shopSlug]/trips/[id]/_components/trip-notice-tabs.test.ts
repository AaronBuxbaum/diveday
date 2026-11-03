import { describe, expect, it } from "vitest";
import { DETAILS_FORMS, pageNoticesFor, ROSTER_FORMS, showsDetailsTab } from "./trip-notice-tabs";

describe("which tab a save lands on", () => {
  it("returns a snorkeler and rider price save to Details, where the row lives", () => {
    expect(DETAILS_FORMS.has("participant-terms")).toBe(true);
  });

  it("never claims a form for both tabs", () => {
    for (const form of ROSTER_FORMS) expect(DETAILS_FORMS.has(form)).toBe(false);
  });
});

describe("pageNoticesFor", () => {
  const notice = (form: string) => ({ form, tone: "success" as const, text: "Saved." });

  it("puts an answer no tab owns at the top of the page", () => {
    expect(pageNoticesFor(notice("page"))).toEqual({
      rootPageNotice: notice("page"),
      rosterPageNotice: undefined,
    });
  });

  it("gives the roster's answer to the roster, and a Details answer to neither slot", () => {
    expect(pageNoticesFor(notice("roster"))).toEqual({
      rootPageNotice: undefined,
      rosterPageNotice: notice("roster"),
    });
    expect(pageNoticesFor(notice("details"))).toEqual({
      rootPageNotice: undefined,
      rosterPageNotice: undefined,
    });
    expect(pageNoticesFor(undefined)).toEqual({
      rootPageNotice: undefined,
      rosterPageNotice: undefined,
    });
  });
});

describe("showsDetailsTab", () => {
  const saved = { form: "timing", tone: "success", text: "Saved" } as const;
  it("opens Details when asked, or when a Details form answered", () => {
    expect(showsDetailsTab("details", undefined, undefined)).toBe(true);
    expect(showsDetailsTab(undefined, undefined, saved)).toBe(true);
    expect(showsDetailsTab(undefined, undefined, undefined)).toBe(false);
  });

  it("keeps the add band's Divers tab when `?add=1` rides beside `?view=details`", () => {
    expect(showsDetailsTab("details", "1", undefined)).toBe(false);
  });
});
