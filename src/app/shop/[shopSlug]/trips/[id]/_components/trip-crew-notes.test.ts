import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { boatClashText, tripCrewNotes } from "./trip-crew-notes";

const t = staffTranslator("en-US");

type Crew = Parameters<typeof tripCrewNotes>[0]["crew"];

function crew(over: Partial<Crew> = {}): Crew {
  return {
    crewGap: { code: "none" },
    ratioGap: { code: "none" },
    languageBriefings: { uncovered: [], covered: [] },
    lapsedCrew: [],
    ...over,
  } as unknown as Crew;
}

describe("tripCrewNotes", () => {
  it("says nothing about a settled crew", () => {
    expect(tripCrewNotes({ crew: crew(), diversPerDivemaster: 8, locale: "en-US", t })).toEqual({
      ratingLapsedNote: null,
      languageGapNote: null,
      underTargetNote: null,
      overRatioWarning: null,
    });
  });

  it("asks staff to check a future-issued rating instead of calling it lapsed", () => {
    const notes = tripCrewNotes({
      crew: crew({ unverifiedCrew: [{ personId: "p1", fullName: "Alex" }] }),
      diversPerDivemaster: 8,
      locale: "en-US",
      t,
    });
    expect(notes.ratingLapsedNote).toBe(
      "Alex has a rating issued after this departure starts. Check the cards.",
    );
  });

  it("names the divers of a missing language, and who can brief a covered one", () => {
    const notes = tripCrewNotes({
      crew: crew({
        languageBriefings: {
          uncovered: [{ language: "de", divers: ["Freya Lindqvist"], crew: [] }],
          covered: [
            { language: "es", divers: ["Ines Costa", "Diego Alvarez"], crew: ["Yusra Idrissi"] },
          ],
        },
      }),
      diversPerDivemaster: 8,
      locale: "en-US",
      t,
    });
    expect(notes.languageGapNote).toBe(
      "Freya Lindqvist booked in German. No one on this crew has recorded German. " +
        "Yusra Idrissi can brief Ines Costa and Diego Alvarez in Spanish.",
    );
  });

  it("counts the people instead of naming them past three, never calling them all divers", () => {
    const notes = tripCrewNotes({
      crew: crew({
        languageBriefings: {
          uncovered: [
            { language: "es", divers: ["A One", "B Two", "C Three", "D Four"], crew: [] },
          ],
          covered: [],
        },
      }),
      diversPerDivemaster: 8,
      locale: "en-US",
      t,
    });
    expect(notes.languageGapNote).toBe(
      "4 people booked in Spanish. No one on this crew has recorded Spanish.",
    );
  });

  it("states the total the shop's target wants, not the shortfall", () => {
    const notes = tripCrewNotes({
      crew: crew({
        ratioGap: { code: "under_target", divers: 12, divemasterCount: 0, needed: 2 } as never,
      }),
      diversPerDivemaster: 6,
      locale: "en-US",
      t,
    });
    expect(notes.underTargetNote).toBe(
      t("trips.crew.underTarget", { divers: 12, divemasters: 0, ratio: 6, needed: 2 }),
    );
  });
});

describe("boatClashText", () => {
  it("names the boat and the other departure", () => {
    expect(
      boatClashText(t, {
        boatName: "Reef Runner",
        otherTitle: "Night Dive",
        otherTripId: "x",
      } as never),
    ).toBe(t("trips.pulse.boatClash", { boat: "Reef Runner", departure: "Night Dive" }));
  });
});
