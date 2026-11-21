import { describe, expect, it } from "vitest";
import { type FeedLabels, type FeedTrip, feedDocument } from "./feed-document";

const labels: FeedLabels = {
  calendarName: "Blue Mantis — my departures",
  crew: "Crew",
  course: "Course",
  day: (dayNumber) => `Day ${dayNumber}`,
};

const trip: FeedTrip = {
  tripId: "trip-1",
  dayNumber: null,
  title: "Molasses Reef, two tanks",
  courseTitle: null,
  startsAt: new Date("2026-08-03T13:00:00.000Z"),
  endsAt: new Date("2026-08-03T17:30:00.000Z"),
  location: "Molasses Reef, Key Largo",
  crew: ["Nora Quinn"],
  revision: 0,
};

function document(trips: FeedTrip[]) {
  return feedDocument({
    trips,
    origin: "https://diveday.test",
    shopSlug: "blue-mantis",
    labels,
    now: new Date("2026-08-01T00:00:00.000Z"),
  });
}

describe("feedDocument", () => {
  it("names the calendar and asks for a refresh, so a subscription is not an untitled URL", () => {
    const file = document([trip]);
    expect(file).toContain("X-WR-CALNAME:Blue Mantis — my departures");
    expect(file).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT60M");
    expect(file).toContain("X-PUBLISHED-TTL:PT60M");
    expect(file).toMatch(/END:VCALENDAR\r\n$/);
  });

  it("writes UTC instants and escapes commas in trip text", () => {
    const file = document([trip]);
    expect(file).toContain("DTSTART:20260803T130000Z\r\nDTEND:20260803T173000Z");
    expect(file).toContain("SUMMARY:Molasses Reef\\, two tanks");
    expect(file).toContain("LOCATION:Molasses Reef\\, Key Largo");
    expect(file).toContain("DTSTAMP:20260801T000000Z");
  });

  it("derives the UID from trip identity, not contents, so an edit updates rather than duplicates", () => {
    const before = document([trip]);
    const after = document([
      { ...trip, title: "Renamed", startsAt: new Date("2026-08-04T13:00:00.000Z") },
    ]);
    expect(before).toContain("UID:trip-trip-1@diveday");
    expect(after).toContain("UID:trip-trip-1@diveday");
  });

  it("gives each day of a multi-day trip its own event and UID", () => {
    const file = document([
      { ...trip, dayNumber: 1 },
      {
        ...trip,
        dayNumber: 2,
        startsAt: new Date("2026-08-04T13:00:00.000Z"),
        endsAt: new Date("2026-08-04T17:30:00.000Z"),
      },
    ]);
    expect(file).toContain("UID:trip-trip-1-day-1@diveday");
    expect(file).toContain("UID:trip-trip-1-day-2@diveday");
    expect(file).toContain("SUMMARY:Molasses Reef\\, two tanks (Day 1)");
    expect(file.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it("renders crew and course through the supplied labels, never hard-coded English", () => {
    const file = feedDocument({
      trips: [{ ...trip, courseTitle: "Open Water", crew: ["Ana Ruiz", "Nora Quinn"] }],
      origin: "https://diveday.test",
      shopSlug: "blue-mantis",
      now: new Date("2026-08-01T00:00:00.000Z"),
      labels: { ...labels, crew: "Tripulación", course: "Curso" },
    });
    expect(file).toContain("Curso: Open Water");
    expect(file).toContain("Tripulación: Ana Ruiz\\, Nora Quinn");
    expect(file).not.toContain("Crew:");
  });

  it("omits a crew line rather than printing an empty one", () => {
    expect(document([{ ...trip, crew: [] }])).not.toContain("Crew:");
  });

  // Until issue #1165 this file asserted the feed "carries no SEQUENCE, which
  // would need a revision counter trips do not have". `trips.revision` is that
  // counter, so the assertion moves here rather than being deleted quietly.
  // The two halves of the reversal: the field ships, and it moves only for a
  // material change, which is what keeps a phone from re-alerting for a
  // conditions note.
  it("writes the trip's revision as SEQUENCE, so a client treats a re-fetch as an update", () => {
    expect(document([trip])).toContain("SEQUENCE:0");
    expect(document([{ ...trip, revision: 4 }])).toContain("SEQUENCE:4");
  });

  it("leaves SEQUENCE where it was when only the title changed", () => {
    expect(document([trip])).toContain("SEQUENCE:0");
    expect(document([{ ...trip, title: "Renamed" }])).toContain("SEQUENCE:0");
  });

  it("produces a valid empty calendar when nothing is scheduled", () => {
    const file = document([]);
    expect(file).toContain("BEGIN:VCALENDAR");
    expect(file).not.toContain("BEGIN:VEVENT");
    expect(file).toMatch(/END:VCALENDAR\r\n$/);
  });
});
