import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { boatClashText, tripCrewNotes } from "./trip-crew-notes";

const t = staffTranslator("en-US");

type Crew = Parameters<typeof tripCrewNotes>[0]["crew"];

function crew(over: Partial<Crew> = {}): Crew {
  return {
    crewGap: { code: "none" },
    ratioGap: { code: "none" },
    languageGap: { code: "none" },
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

  it("names each missing language in the reader's own locale", () => {
    const notes = tripCrewNotes({
      crew: crew({ languageGap: { code: "missing", missing: ["es", "de"] } as never }),
      diversPerDivemaster: 8,
      locale: "en-US",
      t,
    });
    expect(notes.languageGapNote).toContain("Spanish and German");
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
