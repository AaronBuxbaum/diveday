import { describe, expect, it } from "vitest";
import {
  mentionsSite,
  NEXT_DIVE_REASONS,
  type NextDiveCandidate,
  type NextDiveDay,
  pickNextDive,
  rankNextDives,
} from "./next-dive";

/**
 * **What the recap's next-dive card is allowed to claim** (D35, issue #1195).
 *
 * The card prints one sentence saying why this departure and not another, so
 * every rule that produces one has to be a fact the reader could check for
 * themselves. These cases pin exactly that: each reason is reachable only by
 * its own rule, the order between them is fixed, and nothing on the returned
 * shape is a strength a number could later be rendered from.
 */

const DAY: NextDiveDay = {
  justDivedTripId: "trip-just-dived",
  courseId: null,
  shoutout: null,
  siteNames: ["French Reef"],
  lensId: null,
  lensName: null,
};

function candidate(overrides: Partial<NextDiveCandidate> = {}): NextDiveCandidate {
  return {
    tripId: "trip-a",
    title: "Two-Tank Reef",
    startsAt: new Date("2026-09-10T12:00:00Z"),
    courseId: null,
    courseTitle: null,
    siteName: null,
    lensId: null,
    requiredLevel: null,
    seatsLeft: 4,
    ...overrides,
  };
}

describe("mentionsSite", () => {
  it("fires on a whole word, in any case", () => {
    expect(mentionsSite("Come back for the Spiegel Grove.", "Spiegel Grove")).toBe(true);
    expect(mentionsSite("come back for the spiegel grove", "Spiegel Grove")).toBe(true);
  });

  /**
   * The rule this test exists for. A bare `includes` would say the crew named
   * "The Reef" whenever anybody wrote "the reefer was out of ice", which is an
   * invented fact printed as a reason on a keepsake.
   */
  it("does not fire on a site name buried inside a longer word", () => {
    expect(mentionsSite("The reefer ran all day.", "Reef")).toBe(false);
    expect(mentionsSite("Molasses was flat.", "Molasse")).toBe(false);
  });

  it("survives a site name a shop wrote punctuation into", () => {
    // A regex metacharacter in shop free text must fail to match, never throw.
    expect(
      mentionsSite("We dived Christ of the Abyss (statue) twice.", "Christ of the Abyss (statue)"),
    ).toBe(true);
    expect(mentionsSite("Nothing like it.", "C(ave")).toBe(false);
  });

  it("says nothing at all when there is no shoutout or no site", () => {
    expect(mentionsSite(null, "French Reef")).toBe(false);
    expect(mentionsSite("French Reef was lovely", null)).toBe(false);
    expect(mentionsSite("French Reef was lovely", "   ")).toBe(false);
  });
});

describe("the reasons", () => {
  it("prints the crew's own word above everything else", () => {
    const pick = pickNextDive({
      day: { ...DAY, shoutout: "You have to see the Spiegel Grove." },
      candidates: [
        // Sooner, and back to the same site — beaten anyway, because the crew
        // named the other one out loud.
        candidate({
          tripId: "same",
          siteName: "French Reef",
          startsAt: new Date("2026-09-08T12:00:00Z"),
        }),
        candidate({ tripId: "named", siteName: "Spiegel Grove" }),
      ],
    });
    expect(pick).toMatchObject({
      tripId: "named",
      reason: "crew_named_site",
      reasonSite: "Spiegel Grove",
    });
  });

  it("puts a student back on their own course before any site rule", () => {
    const pick = pickNextDive({
      day: { ...DAY, courseId: "course-ow" },
      candidates: [
        candidate({
          tripId: "same-site",
          siteName: "French Reef",
          startsAt: new Date("2026-09-08T12:00:00Z"),
        }),
        candidate({ tripId: "session", courseId: "course-ow", courseTitle: "Open Water Diver" }),
      ],
    });
    expect(pick).toMatchObject({
      tripId: "session",
      reason: "course_next_session",
      reasonCourse: "Open Water Diver",
    });
  });

  it("names the site the day went to when nothing louder applies", () => {
    const pick = pickNextDive({
      day: DAY,
      candidates: [
        candidate({
          tripId: "elsewhere",
          siteName: "Benwood",
          startsAt: new Date("2026-09-08T12:00:00Z"),
        }),
        candidate({ tripId: "back", siteName: "french reef" }),
      ],
    });
    expect(pick).toMatchObject({ tripId: "back", reason: "same_site", reasonSite: "french reef" });
  });

  it("falls back to the soonest departure with a seat, and says so", () => {
    const pick = pickNextDive({
      day: DAY,
      candidates: [
        candidate({ tripId: "later", startsAt: new Date("2026-09-12T12:00:00Z") }),
        candidate({ tripId: "sooner", startsAt: new Date("2026-09-08T12:00:00Z") }),
      ],
    });
    expect(pick).toMatchObject({ tripId: "sooner", reason: "soonest_with_room" });
    expect(pick?.reasonSite).toBeUndefined();
    expect(pick?.reasonCourse).toBeUndefined();
  });

  it("keeps the precedence order the union declares", () => {
    expect(NEXT_DIVE_REASONS).toEqual([
      "crew_named_site",
      "course_next_session",
      "same_lens",
      "same_site",
      "soonest_with_room",
    ]);
    const ranked = rankNextDives({
      day: {
        ...DAY,
        courseId: "course-ow",
        shoutout: "The Spiegel Grove, next time.",
        lensId: "lens-easy",
        lensName: "easygoing reef",
      },
      candidates: [
        candidate({ tripId: "plain", startsAt: new Date("2026-09-07T12:00:00Z") }),
        candidate({
          tripId: "site",
          siteName: "French Reef",
          startsAt: new Date("2026-09-07T13:00:00Z"),
        }),
        candidate({
          tripId: "lens",
          lensId: "lens-easy",
          startsAt: new Date("2026-09-07T13:30:00Z"),
        }),
        candidate({
          tripId: "course",
          courseId: "course-ow",
          startsAt: new Date("2026-09-07T14:00:00Z"),
        }),
        candidate({
          tripId: "shout",
          siteName: "Spiegel Grove",
          startsAt: new Date("2026-09-07T15:00:00Z"),
        }),
      ],
    });
    // Every one of them is sooner than the one above it, and every one loses.
    expect(ranked.map((row) => row.reason)).toEqual(NEXT_DIVE_REASONS);
  });
});

describe("same_lens", () => {
  /**
   * The shop's own word for a kind of day (`trips.lens_id`, ADR 20260904
   * decision 2). The rule is a literal id equality and these cases are here to
   * keep it one: a lens reason that could fire on anything but the same row
   * would be the module inventing an affinity, which is the one thing every
   * other rule is written to refuse.
   */
  it("fires when the candidate wears the same lens as the day just dived", () => {
    const pick = pickNextDive({
      day: { ...DAY, lensId: "lens-easy", lensName: "easygoing reef" },
      candidates: [candidate({ tripId: "same-lens", lensId: "lens-easy" })],
    });
    expect(pick).toMatchObject({ reason: "same_lens", reasonLens: "easygoing reef" });
  });

  it("never fires on a different lens, however alike the words", () => {
    const pick = pickNextDive({
      // Two words a shop deliberately kept apart. Nothing here may read them.
      day: { ...DAY, lensId: "lens-easy", lensName: "easygoing reef" },
      candidates: [candidate({ tripId: "other", lensId: "lens-easygoing-reef" })],
    });
    expect(pick?.reason).toBe("soonest_with_room");
    expect(pick?.reasonLens).toBeUndefined();
  });

  it("never fires when the day wore no lens, whatever the candidates wear", () => {
    const pick = pickNextDive({
      day: { ...DAY, lensId: null, lensName: null },
      candidates: [candidate({ tripId: "lensed", lensId: "lens-easy" })],
    });
    expect(pick?.reason).toBe("soonest_with_room");
  });

  it("loses to the course session and beats the site", () => {
    const ranked = rankNextDives({
      day: {
        ...DAY,
        courseId: "course-ow",
        lensId: "lens-easy",
        lensName: "easygoing reef",
      },
      candidates: [
        // Both sooner than the course session, and both still lose to it.
        candidate({
          tripId: "site",
          siteName: "French Reef",
          startsAt: new Date("2026-09-07T12:00:00Z"),
        }),
        candidate({
          tripId: "lens",
          lensId: "lens-easy",
          startsAt: new Date("2026-09-07T13:00:00Z"),
        }),
        candidate({
          tripId: "course",
          courseId: "course-ow",
          startsAt: new Date("2026-09-07T14:00:00Z"),
        }),
      ],
    });
    expect(ranked.map((row) => row.tripId)).toEqual(["course", "lens", "site"]);
  });

  it("carries no lens word onto a pick made for another reason", () => {
    const pick = pickNextDive({
      day: { ...DAY, lensId: "lens-easy", lensName: "easygoing reef" },
      candidates: [candidate({ tripId: "site", siteName: "French Reef" })],
    });
    expect(pick?.reason).toBe("same_site");
    expect(pick?.reasonLens).toBeUndefined();
  });
});

describe("what is never picked", () => {
  it("never points a diver back at the departure they just came home from", () => {
    const pick = pickNextDive({
      day: { ...DAY, shoutout: "French Reef was the best of the season." },
      candidates: [
        // The loudest possible candidate — and it is the day itself.
        candidate({ tripId: DAY.justDivedTripId, siteName: "French Reef" }),
      ],
    });
    expect(pick).toBeNull();
  });

  it("returns null on an empty board rather than an invented suggestion", () => {
    expect(pickNextDive({ day: DAY, candidates: [] })).toBeNull();
  });
});

describe("the shape", () => {
  it("carries no score of any kind", () => {
    const pick = pickNextDive({ day: DAY, candidates: [candidate()] });
    expect(pick).not.toBeNull();
    for (const key of Object.keys(pick ?? {})) {
      expect(key).not.toMatch(/score|rank|weight|confidence|match/i);
    }
    // `seatsLeft` is the one number, and it is a plain count of open seats.
    expect(pick?.seatsLeft).toBe(4);
  });

  it("states the level the departure demands, and nothing when it demands none", () => {
    const gated = pickNextDive({
      day: DAY,
      candidates: [candidate({ requiredLevel: "advanced_open_water" })],
    });
    expect(gated?.levelCovered).toBe("advanced_open_water");
    expect(pickNextDive({ day: DAY, candidates: [candidate()] })?.levelCovered).toBeNull();
  });

  it("agrees with rankNextDives about which departure leads", () => {
    // 16e's "Also worth a look" reads the tail of this same list, so the two
    // can never disagree about the head.
    const input = {
      day: DAY,
      candidates: [
        candidate({ tripId: "b", startsAt: new Date("2026-09-11T12:00:00Z") }),
        candidate({ tripId: "a", startsAt: new Date("2026-09-09T12:00:00Z") }),
      ],
    };
    expect(pickNextDive(input)).toEqual(rankNextDives(input)[0]);
  });

  it("orders two equal candidates by id so a frozen clock renders one card twice", () => {
    const at = new Date("2026-09-09T12:00:00Z");
    const ranked = rankNextDives({
      day: DAY,
      candidates: [
        candidate({ tripId: "zz", startsAt: at }),
        candidate({ tripId: "aa", startsAt: at }),
      ],
    });
    expect(ranked.map((row) => row.tripId)).toEqual(["aa", "zz"]);
  });
});
