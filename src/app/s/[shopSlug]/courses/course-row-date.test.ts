import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { courseNextStartLabel } from "../course-date-label";
import { courseRowDate } from "./course-row-date";

const t = diverTranslator("en-US");
const base = { locale: "en-US", timeZone: "America/Cancun", t };

describe("courseRowDate", () => {
  it("names the next session in the shop's own zone, as the shelf does", () => {
    // 1:00 AM Saturday UTC is still Friday evening in Cancún.
    const nextStart = new Date("2026-10-24T01:00:00.000Z");
    expect(courseRowDate({ ...base, nextStart, canAsk: true })).toEqual({
      kind: "next",
      text: expect.stringMatching(/^Next Fri,\sOct\s23$/),
    });
  });

  it("formats the same next-start label used by the public home shelf", () => {
    expect(
      courseNextStartLabel(new Date("2026-10-24T01:00:00.000Z"), base.locale, base.timeZone, t),
    ).toMatch(/^Next Fri,\sOct\s23$/);
  });

  it("offers to ask for a date when nothing is on the board", () => {
    expect(courseRowDate({ ...base, nextStart: null, canAsk: true })).toEqual({
      kind: "ask",
      text: "Ask for a date",
    });
  });

  it("says nothing when there is no date and nowhere to ask", () => {
    expect(courseRowDate({ ...base, nextStart: null, canAsk: false })).toBeNull();
  });
});
