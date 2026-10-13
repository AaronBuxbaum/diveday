import { describe, expect, it } from "vitest";
import {
  containsLink,
  DEPARTURE_NOTE_MAX,
  DEPARTURE_NOTES_PER_DEPARTURE,
  departureNoteBlock,
  departureNoteProblem,
  foldDepartureNote,
} from "./departure-notes";

describe("foldDepartureNote", () => {
  it("folds every run of whitespace, newlines included, to one space", () => {
    expect(foldDepartureNote("  Marina lot closed.\n\nPark   at the Elks.\t")).toBe(
      "Marina lot closed. Park at the Elks.",
    );
  });
});

describe("containsLink", () => {
  it.each([
    "see https://example.com",
    "HTTP://EXAMPLE.COM",
    "ftp://files",
    "go to www.example",
    "write to captain@shop",
    "elks.org has the map",
    "bit.ly/x",
    "map at example.co.uk",
    "tienda.es",
    "javascript://alert",
    // Dots a phone still links: ideographic, halfwidth and fullwidth.
    "evil。example",
    "evil｡example",
    "evil．example",
    // Fullwidth letters fold to the ASCII a browser resolves.
    "ｅｖｉｌ.ｃｏｍ",
  ])("catches %s", (text) => {
    expect(containsLink(text)).toBe(true);
  });

  it.each([
    "Marina lot closed, park at the Elks.",
    "Meet at 7 a.m. at slip 4",
    "Bring a hoodie, e.g. something warm.",
    "Dock 3. Bring cash for parking.",
    "Water is 24.5°C today",
    "Llegada 7:30, muelle 3.",
  ])("lets %s through", (text) => {
    expect(containsLink(text)).toBe(false);
  });
});

describe("departureNoteProblem", () => {
  it("refuses an empty or blank note", () => {
    expect(departureNoteProblem("")).toBe("empty");
    expect(departureNoteProblem(" \n\t ")).toBe("empty");
  });

  it("allows exactly the limit, after folding, and refuses one more", () => {
    expect(departureNoteProblem("a".repeat(DEPARTURE_NOTE_MAX))).toBeNull();
    expect(departureNoteProblem(`  ${"a".repeat(DEPARTURE_NOTE_MAX)}\n\n`)).toBeNull();
    expect(departureNoteProblem("a".repeat(DEPARTURE_NOTE_MAX + 1))).toBe("too_long");
  });

  it("refuses a link", () => {
    expect(departureNoteProblem("Park at elks.org")).toBe("link");
  });

  it("allows a plain transactional note", () => {
    expect(departureNoteProblem("Marina lot closed, park at the Elks lodge.")).toBeNull();
  });
});

describe("departureNoteBlock", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  const later = new Date("2026-10-12T15:00:00Z");

  it("takes a note on a scheduled departure that has not sailed", () => {
    expect(departureNoteBlock({ status: "scheduled", startsAt: later }, 0, now)).toBeNull();
  });

  it("refuses a cancelled departure", () => {
    expect(departureNoteBlock({ status: "cancelled", startsAt: later }, 0, now)).toBe("cancelled");
  });

  it("refuses a departure that has sailed", () => {
    expect(
      departureNoteBlock(
        { status: "scheduled", startsAt: new Date("2026-10-12T09:00:00Z") },
        0,
        now,
      ),
    ).toBe("past");
  });

  // #2393: a multi-day course is one departure whose later days still have
  // students to tell where to park; it is open until its last day sails.
  it("takes a note on a course whose first day sailed while a later day is ahead", () => {
    const trip = {
      status: "scheduled",
      startsAt: new Date("2026-10-11T09:00:00Z"),
      lastDayStartsAt: new Date("2026-10-13T09:00:00Z"),
    };
    expect(departureNoteBlock(trip, 0, now)).toBeNull();
    expect(departureNoteBlock(trip, DEPARTURE_NOTES_PER_DEPARTURE, now)).toBe("limit");
  });

  it("refuses a course once its last day has sailed", () => {
    expect(
      departureNoteBlock(
        {
          status: "scheduled",
          startsAt: new Date("2026-10-10T09:00:00Z"),
          lastDayStartsAt: new Date("2026-10-12T09:00:00Z"),
        },
        0,
        now,
      ),
    ).toBe("past");
  });

  it("refuses past the per-departure cap", () => {
    const trip = { status: "scheduled", startsAt: later };
    expect(departureNoteBlock(trip, DEPARTURE_NOTES_PER_DEPARTURE - 1, now)).toBeNull();
    expect(departureNoteBlock(trip, DEPARTURE_NOTES_PER_DEPARTURE, now)).toBe("limit");
  });

  it("names cancellation before the clock", () => {
    expect(
      departureNoteBlock(
        { status: "cancelled", startsAt: new Date("2026-10-11T09:00:00Z") },
        9,
        now,
      ),
    ).toBe("cancelled");
  });
});
