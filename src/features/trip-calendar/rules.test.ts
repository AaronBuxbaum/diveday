import { describe, expect, it } from "vitest";
import { courseCalendarFile, tripCalendarFile } from "./rules";

describe("tripCalendarFile", () => {
  it("writes UTC times and escapes diver-facing text", () => {
    const file = tripCalendarFile({
      title: "Reef, wreck; & rays",
      description: "Meet aboard\nBring a towel",
      startsAt: new Date("2026-08-03T13:00:00.000Z"),
      endsAt: new Date("2026-08-03T17:30:00.000Z"),
      location: "Molasses Reef, Key Largo",
      url: "https://diveday.test/s/blue-mantis/trips/trip-1",
      revision: 0,
    });

    expect(file).toContain("DTSTART:20260803T130000Z\r\nDTEND:20260803T173000Z");
    expect(file).toContain("SUMMARY:Reef\\, wreck\\; & rays");
    expect(file).toContain("LOCATION:Molasses Reef\\, Key Largo");
    expect(file).toContain("Meet aboard\\nBring a towel");
    // Written at zero rather than omitted: an absent SEQUENCE and a zero are
    // different facts to a calendar client (issue #1165).
    expect(file).toContain("SEQUENCE:0");
    expect(file).toMatch(/END:VCALENDAR\r\n$/);
  });

  it("publishes the trip's own revision as SEQUENCE, so a moved departure updates the diver's entry", () => {
    const file = tripCalendarFile({
      title: "Molasses Reef, two tanks",
      startsAt: new Date("2026-08-03T13:00:00.000Z"),
      endsAt: new Date("2026-08-03T17:30:00.000Z"),
      url: "https://diveday.test/s/blue-mantis/trips/trip-1",
      revision: 3,
    });

    expect(file).toContain("SEQUENCE:3");
  });
});

describe("courseCalendarFile", () => {
  const course = {
    title: "Open Water",
    description: "Learn with an instructor",
    startsAt: new Date("2026-10-31T12:00:00Z"),
    endsAt: new Date("2026-11-07T21:00:00Z"),
    url: "https://diveday.test/s/shop/trips/course",
    revision: 2,
    scheduleDays: [
      { title: "Classroom", items: ["Confined water skills"] },
      { title: "Open water", items: ["Practice dives"] },
    ],
    meetings: [
      {
        dayNumber: 1,
        startsAt: new Date("2026-10-31T12:00:00Z"),
        endsAt: new Date("2026-10-31T21:00:00Z"),
      },
      {
        dayNumber: 2,
        startsAt: new Date("2026-11-07T13:00:00Z"),
        endsAt: new Date("2026-11-07T21:00:00Z"),
      },
    ],
  };

  it("preserves nonconsecutive meeting instants across DST and stable day identities after an edit", () => {
    const file = courseCalendarFile(course);
    expect(file.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(file).toContain("DTSTART:20261031T120000Z\r\nDTEND:20261031T210000Z");
    expect(file).toContain("DTSTART:20261107T130000Z\r\nDTEND:20261107T210000Z");
    expect(file).toContain(`UID:${course.url}@diveday`);
    const moved = courseCalendarFile({
      ...course,
      revision: 3,
      meetings: course.meetings.map((day) => ({
        ...day,
        startsAt: new Date(day.startsAt.getTime() + 60_000),
      })),
    });
    expect(moved.match(/^UID:.*$/gm)).toEqual(file.match(/^UID:.*$/gm));
    expect(moved.match(/SEQUENCE:3/g)).toHaveLength(2);
    expect(file).toContain("Classroom\\nConfined water skills");
  });

  it("does not assign a mismatched catalog plan to dated meetings or derive times from it", () => {
    const file = courseCalendarFile({
      ...course,
      scheduleDays: [{ title: "Unmatched plan", startTime: "07:00", endTime: "19:00", items: [] }],
    });
    expect(file).not.toContain("Unmatched plan");
    expect(file).toContain("DTSTART:20261031T120000Z");
  });

  it("uses the recorded session window when meeting rows are absent, without fabricating days", () => {
    const file = courseCalendarFile({ ...course, meetings: [] });
    expect(file.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(file).toContain("DTSTART:20261031T120000Z\r\nDTEND:20261107T210000Z");
    expect(file).not.toContain("Classroom");
  });
});
