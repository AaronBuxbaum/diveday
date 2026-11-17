import { describe, expect, it } from "vitest";
import { EDIT_TRIP_FORMS, pageNoticesFor, ROSTER_FORMS, showsEditTrip } from "./trip-notice-views";

describe("where a save lands", () => {
  it("returns a snorkeler and rider price save to Edit trip, where the row lives", () => {
    expect(EDIT_TRIP_FORMS.has("participant-terms")).toBe(true);
  });

  it("never claims a form for both views", () => {
    for (const form of ROSTER_FORMS) expect(EDIT_TRIP_FORMS.has(form)).toBe(false);
  });
});

describe("pageNoticesFor", () => {
  const notice = (form: string) => ({ form, tone: "success" as const, text: "Saved." });

  it("puts an answer no view owns at the top of the page", () => {
    expect(pageNoticesFor(notice("page"))).toEqual({
      rootPageNotice: notice("page"),
      rosterPageNotice: undefined,
    });
  });

  it("gives the roster's answer to the roster, and an Edit trip answer to neither slot", () => {
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

describe("showsEditTrip", () => {
  const saved = { form: "timing", tone: "success", text: "Saved" } as const;
  it("opens Edit trip when asked, or when one of its forms answered", () => {
    expect(showsEditTrip("edit", undefined, undefined)).toBe(true);
    expect(showsEditTrip(undefined, undefined, saved)).toBe(true);
    expect(showsEditTrip(undefined, undefined, undefined)).toBe(false);
  });

  it("keeps the add band with the guests when `?add=1` rides beside `?view=edit`", () => {
    expect(showsEditTrip("edit", "1", undefined)).toBe(false);
  });
});
