import { describe, expect, it } from "vitest";
import {
  countBothClaims,
  countInWaterCrew,
  effectiveCrewRoles,
  groupCrewAssignments,
  inWaterCrewRole,
  type LapsedRung,
  lapsedRungs,
  lastDayOfDeparture,
  narrowedByLapse,
  rungLostToLapse,
  standingRatingsBesideJob,
  TRIP_CREW_ROLES,
} from "./crew-roles";

/**
 * DOM-M3. Who counts as an instructor and who counts as an in-water certified
 * assistant decides the supervision ratio, which decides how many students may
 * be in the water with them. It was written out five times across `src/db` and
 * `src/app` and named nowhere in `src/lib`, and every copy read shop-wide
 * roles — so a divemaster rostered as *this trip's boat captain* still bought
 * two students' worth of capacity, and a shop-wide instructor rostered as deck
 * crew was worth eight and cleared a course's "unstaffed" gap on his own.
 *
 * `src/lib/course-ratios.test.ts` exercises the arithmetic from bare numbers
 * and never touches the role→count mapping. This is that mapping.
 */
describe("inWaterCrewRole", () => {
  it("falls back to shop-wide inference when no per-trip role is specified", () => {
    // The status quo, exactly: every `trip_assignments` row written before the
    // column existed is null here and must keep counting as it always did.
    expect(inWaterCrewRole({ tripRole: null, shopRoles: ["instructor"] })).toBe("instructor");
    expect(inWaterCrewRole({ tripRole: null, shopRoles: ["divemaster"] })).toBe(
      "certified_assistant",
    );
    // A person holding both is the instructor, never also their own assistant.
    expect(inWaterCrewRole({ tripRole: null, shopRoles: ["instructor", "divemaster"] })).toBe(
      "instructor",
    );
    expect(inWaterCrewRole({ tripRole: null, shopRoles: ["captain"] })).toBe("none");
    expect(inWaterCrewRole({ tripRole: null, shopRoles: ["crew"] })).toBe("none");
    expect(inWaterCrewRole({ tripRole: null, shopRoles: [] })).toBe("none");
    // Undefined reads the same as null — a caller that has no column value and
    // a caller that has a null one must not diverge.
    expect(inWaterCrewRole({ shopRoles: ["divemaster"] })).toBe("certified_assistant");
  });

  it("takes a divemaster rostered as this trip's captain out of the water", () => {
    // The finding, stated as a test.
    expect(inWaterCrewRole({ tripRole: "captain", shopRoles: ["divemaster"] })).toBe("none");
    expect(inWaterCrewRole({ tripRole: "crew", shopRoles: ["divemaster"] })).toBe("none");
    // And the instructor on the helm or the deck is not supervising either.
    expect(inWaterCrewRole({ tripRole: "captain", shopRoles: ["instructor"] })).toBe("none");
    expect(inWaterCrewRole({ tripRole: "crew", shopRoles: ["instructor", "divemaster"] })).toBe(
      "none",
    );
  });

  it("lets an instructor work a trip as its divemaster — a downgrade, and a real one", () => {
    expect(inWaterCrewRole({ tripRole: "divemaster", shopRoles: ["instructor"] })).toBe(
      "certified_assistant",
    );
    expect(
      inWaterCrewRole({ tripRole: "divemaster", shopRoles: ["instructor", "divemaster"] }),
    ).toBe("certified_assistant");
  });

  it("never lets the roster mint a credential the person does not hold", () => {
    // Rostering the deckhand as "instructor" buys the session nothing: a
    // scheduling document cannot make somebody an instructor.
    expect(inWaterCrewRole({ tripRole: "instructor", shopRoles: ["crew"] })).toBe("none");
    expect(inWaterCrewRole({ tripRole: "instructor", shopRoles: [] })).toBe("none");
    // A divemaster rostered as the instructor still counts only as an assistant.
    expect(inWaterCrewRole({ tripRole: "instructor", shopRoles: ["divemaster"] })).toBe(
      "certified_assistant",
    );
    expect(inWaterCrewRole({ tripRole: "divemaster", shopRoles: ["captain"] })).toBe("none");
  });

  /**
   * Issue #1680, ruled 2026-09-16. A shop with an Assistant Instructor on staff
   * had nowhere to file them but `instructor`, so this function returned a full
   * `"instructor"`: eight students' worth of allowance under the entry-level
   * cap, and enough on its own to clear a course's "needs an instructor" gap.
   * Under PADI an AI is a certified assistant for training-dive ratios and does
   * not independently conduct a Discover Scuba experience, where an assistant
   * buys no seats at all — so the intro cap is where the old answer was most
   * wrong, and these are the cases that pin the new one.
   */
  describe("the assistant_instructor rung", () => {
    it("counts as a certified assistant, never as an instructor", () => {
      expect(inWaterCrewRole({ tripRole: null, shopRoles: ["assistant_instructor"] })).toBe(
        "certified_assistant",
      );
      expect(inWaterCrewRole({ shopRoles: ["assistant_instructor"] })).toBe("certified_assistant");
      expect(inWaterCrewRole({ tripRole: "divemaster", shopRoles: ["assistant_instructor"] })).toBe(
        "certified_assistant",
      );
    });

    it("cannot be promoted by the roster", () => {
      // Property 2, on the rung the roster is most likely to be optimistic
      // about: the shop needs an instructor on the session and puts the AI in
      // the slot. The count takes the qualification, not the roster line.
      expect(inWaterCrewRole({ tripRole: "instructor", shopRoles: ["assistant_instructor"] })).toBe(
        "certified_assistant",
      );
    });

    it("leaves the water with the rest of them when rostered dry", () => {
      expect(inWaterCrewRole({ tripRole: "captain", shopRoles: ["assistant_instructor"] })).toBe(
        "none",
      );
      expect(inWaterCrewRole({ tripRole: "crew", shopRoles: ["assistant_instructor"] })).toBe(
        "none",
      );
    });

    it("loses to a full instructor rating held by the same person", () => {
      // A shop that promoted somebody and left the old rung ticked. Both roles
      // stand, and the higher one answers — the same rule `instructor` +
      // `divemaster` has always followed.
      expect(
        inWaterCrewRole({ tripRole: null, shopRoles: ["assistant_instructor", "instructor"] }),
      ).toBe("instructor");
    });
  });

  /**
   * The invariant that makes this migration safe to ship: adding a per-trip
   * role can only ever *lower* what a person is worth to the ratio, never raise
   * it. So no existing session can silently gain capacity because somebody
   * filled in a roster field.
   */
  it("is monotone — a per-trip role never raises the count above the shop-wide inference", () => {
    const weight = { none: 0, certified_assistant: 1, instructor: 2 } as const;
    const roleSets = [
      [],
      ["crew"],
      ["captain"],
      ["divemaster"],
      ["instructor"],
      ["instructor", "divemaster"],
      ["owner", "divemaster"],
      ["assistant_instructor"],
      ["assistant_instructor", "divemaster"],
      ["assistant_instructor", "instructor"],
    ];
    for (const shopRoles of roleSets) {
      const baseline = weight[inWaterCrewRole({ tripRole: null, shopRoles })];
      for (const tripRole of TRIP_CREW_ROLES) {
        expect(weight[inWaterCrewRole({ tripRole, shopRoles })]).toBeLessThanOrEqual(baseline);
      }
    }
  });
});

describe("countInWaterCrew", () => {
  it("counts each person once, taking the instructor over their own assistant slot", () => {
    expect(
      countInWaterCrew([
        { tripRole: null, shopRoles: ["instructor", "divemaster"] },
        { tripRole: null, shopRoles: ["divemaster"] },
        { tripRole: null, shopRoles: ["captain"] },
      ]),
    ).toEqual({ instructorCount: 1, assistantCount: 1 });
  });

  it("drops a rostered captain out of the ratio while an unrostered one still counts", () => {
    const dm = ["divemaster"];
    // Same person, same qualification — only the roster line differs.
    expect(countInWaterCrew([{ tripRole: "captain", shopRoles: dm }])).toEqual({
      instructorCount: 0,
      assistantCount: 0,
    });
    expect(countInWaterCrew([{ tripRole: null, shopRoles: dm }])).toEqual({
      instructorCount: 0,
      assistantCount: 1,
    });
  });

  it("stops a shop-wide instructor rostered as deck crew from staffing a course", () => {
    expect(countInWaterCrew([{ tripRole: "crew", shopRoles: ["instructor"] }])).toEqual({
      instructorCount: 0,
      assistantCount: 0,
    });
  });

  it("counts an assistant instructor beside the instructor, not as one", () => {
    // The shape #1680 is about: one instructor and one AI on a course session.
    // Before the rung existed the shop filed the AI as `instructor` and this
    // read `{ instructorCount: 2 }` — which clears an intro session's 2:1 cap
    // for four participants and clears the "needs an instructor" gap twice.
    expect(
      countInWaterCrew([
        { tripRole: null, shopRoles: ["instructor"] },
        { tripRole: null, shopRoles: ["assistant_instructor"] },
      ]),
    ).toEqual({ instructorCount: 1, assistantCount: 1 });
  });

  it("is empty-safe", () => {
    expect(countInWaterCrew([])).toEqual({ instructorCount: 0, assistantCount: 0 });
  });
});

/**
 * Issue #1853. An expired rating counted toward the supervision ratio, so the
 * staffing line could say a course was supervised when the only instructor on
 * it was out of teaching status. The ruling (2026-09-16) reads the credential
 * where the ratio is computed; H-59 keeps selling and seating on the roster's
 * claim, which is why the narrowing is something a caller passes rather than
 * something `inWaterCrewRole` looks up.
 */
describe("lapsedRungs", () => {
  const rating = (kind: string, renewsAt: string | null) => ({ kind, renewsAt });
  const DIVE_DAY = "2026-10-10";

  it("says nothing about a person with no rating recorded — silence is not a lapse", () => {
    expect(lapsedRungs([], DIVE_DAY)).toEqual([]);
    // Credentials that evidence no in-water rung are not ratings either.
    expect(
      lapsedRungs(
        [rating("first_aid_cpr", "2020-01-01"), rating("captains_licence", "2020-01-01")],
        DIVE_DAY,
      ),
    ).toEqual([]);
  });

  it("counts a rating with no renewal date recorded as current", () => {
    expect(lapsedRungs([rating("instructor_rating", null)], DIVE_DAY)).toEqual([]);
  });

  it("counts a rating renewing on the morning of the dive — good through its own day", () => {
    expect(lapsedRungs([rating("instructor_rating", DIVE_DAY)], DIVE_DAY)).toEqual([]);
  });

  it("lapses a rating that renewed the day before the dive, off both rungs", () => {
    // A lapsed professional is out of status at every rung, so the instructor
    // rating was also the only evidence for the assistant rung.
    expect(lapsedRungs([rating("instructor_rating", "2026-10-09")], DIVE_DAY)).toEqual([
      "instructor",
      "certified_assistant",
    ]);
  });

  it("keeps the assistant rung on a current Divemaster rating beside a lapsed instructor one", () => {
    expect(
      lapsedRungs(
        [rating("instructor_rating", "2026-10-09"), rating("divemaster_rating", "2027-01-01")],
        DIVE_DAY,
      ),
    ).toEqual(["instructor"]);
  });

  it("lapses an Assistant Instructor's rating off the assistant rung only (issue #1850)", () => {
    // The rung an AI stands on is the assistant one; their rating says nothing
    // about whether they may teach as an instructor.
    expect(lapsedRungs([rating("assistant_instructor_rating", "2026-10-09")], DIVE_DAY)).toEqual([
      "certified_assistant",
    ]);
    expect(lapsedRungs([rating("assistant_instructor_rating", "2027-01-01")], DIVE_DAY)).toEqual(
      [],
    );
  });

  it("needs every rating for a rung lapsed — one current card is enough", () => {
    // Two agencies' instructor ratings, one renewed and one not.
    expect(
      lapsedRungs(
        [rating("instructor_rating", "2025-01-01"), rating("instructor_rating", "2027-01-01")],
        DIVE_DAY,
      ),
    ).toEqual([]);
    // And an undated one beside a lapsed one: nothing is known to be lapsed.
    expect(
      lapsedRungs(
        [rating("instructor_rating", "2025-01-01"), rating("instructor_rating", null)],
        DIVE_DAY,
      ),
    ).toEqual([]);
  });

  it("reads a date that is not a real calendar date as no date, never as a lapse", () => {
    expect(lapsedRungs([rating("instructor_rating", "2026-02-31")], DIVE_DAY)).toEqual([]);
  });

  it("answers for the dive day, so a rating lapsing between booking and the dive is lapsed", () => {
    // Current on the day the seat was sold, gone by the day in the water.
    const renews = "2026-10-05";
    expect(lapsedRungs([rating("instructor_rating", renews)], "2026-10-01")).toEqual([]);
    expect(lapsedRungs([rating("instructor_rating", renews)], DIVE_DAY)).toEqual([
      "instructor",
      "certified_assistant",
    ]);
  });
});

describe("lastDayOfDeparture", () => {
  it("is the shop-local day, not the UTC one", () => {
    // 01:30 UTC on the 11th is still the evening of the 10th in New York.
    expect(lastDayOfDeparture(new Date("2026-10-11T01:30:00Z"), "America/New_York")).toBe(
      "2026-10-10",
    );
    // And 23:30 UTC on the 10th is already the morning of the 11th in Sydney.
    expect(lastDayOfDeparture(new Date("2026-10-10T23:30:00Z"), "Australia/Sydney")).toBe(
      "2026-10-11",
    );
  });

  it("keeps a departure ending exactly at local midnight on the day it ran", () => {
    expect(lastDayOfDeparture(new Date("2026-10-11T04:00:00Z"), "America/New_York")).toBe(
      "2026-10-10",
    );
  });
});

describe("inWaterCrewRole with recorded lapses", () => {
  const both: LapsedRung[] = ["instructor", "certified_assistant"];

  it("counts an instructor whose every rating lapsed for nothing", () => {
    expect(inWaterCrewRole({ tripRole: null, shopRoles: ["instructor"], lapsedRungs: both })).toBe(
      "none",
    );
    expect(
      inWaterCrewRole({ tripRole: "instructor", shopRoles: ["instructor"], lapsedRungs: both }),
    ).toBe("none");
  });

  it("lets a current Divemaster card count when only the instructor rating lapsed", () => {
    const lapsed: LapsedRung[] = ["instructor"];
    expect(
      inWaterCrewRole({ tripRole: null, shopRoles: ["instructor"], lapsedRungs: lapsed }),
    ).toBe("certified_assistant");
    expect(
      inWaterCrewRole({ tripRole: "instructor", shopRoles: ["instructor"], lapsedRungs: lapsed }),
    ).toBe("certified_assistant");
  });

  it("takes a lapsed Divemaster or Assistant Instructor out of the assistant count", () => {
    const lapsed: LapsedRung[] = ["certified_assistant"];
    expect(inWaterCrewRole({ shopRoles: ["divemaster"], lapsedRungs: lapsed })).toBe("none");
    expect(inWaterCrewRole({ shopRoles: ["assistant_instructor"], lapsedRungs: lapsed })).toBe(
      "none",
    );
  });

  it("changes nothing when the credentials were not read, or nothing lapsed", () => {
    // The roster's claim — what the booking gate still reads (H-59).
    expect(inWaterCrewRole({ shopRoles: ["instructor"] })).toBe("instructor");
    expect(inWaterCrewRole({ shopRoles: ["instructor"], lapsedRungs: [] })).toBe("instructor");
  });

  it("is monotone — a recorded lapse never raises what anybody is worth", () => {
    const weight = { none: 0, certified_assistant: 1, instructor: 2 } as const;
    const lapseSets: LapsedRung[][] = [[], ["instructor"], ["certified_assistant"], both];
    const roleSets = [
      [],
      ["captain"],
      ["divemaster"],
      ["instructor"],
      ["instructor", "divemaster"],
      ["assistant_instructor"],
      ["assistant_instructor", "instructor"],
    ];
    for (const shopRoles of roleSets) {
      for (const tripRole of [null, ...TRIP_CREW_ROLES]) {
        const baseline = weight[inWaterCrewRole({ tripRole, shopRoles })];
        for (const lapsed of lapseSets) {
          expect(
            weight[inWaterCrewRole({ tripRole, shopRoles, lapsedRungs: lapsed })],
          ).toBeLessThanOrEqual(baseline);
        }
      }
    }
  });
});

describe("countInWaterCrew with recorded lapses", () => {
  it("counts two instructors with one expired as one", () => {
    expect(
      countInWaterCrew([
        { tripRole: null, shopRoles: ["instructor"], lapsedRungs: [] },
        {
          tripRole: null,
          shopRoles: ["instructor"],
          lapsedRungs: ["instructor", "certified_assistant"],
        },
      ]),
    ).toEqual({ instructorCount: 1, assistantCount: 0 });
  });

  it("counts a course whose only instructor lapsed as having none", () => {
    expect(
      countInWaterCrew([
        {
          tripRole: "instructor",
          shopRoles: ["instructor"],
          lapsedRungs: ["instructor", "certified_assistant"],
        },
      ]),
    ).toEqual({ instructorCount: 0, assistantCount: 0 });
  });
});

describe("narrowedByLapse", () => {
  it("names only the people a lapse actually took down a rung", () => {
    expect(
      narrowedByLapse({
        shopRoles: ["instructor"],
        lapsedRungs: ["instructor", "certified_assistant"],
      }),
    ).toBe(true);
    // Lapsed, but rostered as the captain — worth nothing either way, so the
    // lapse is not why the session is short.
    expect(
      narrowedByLapse({
        tripRole: "captain",
        shopRoles: ["instructor"],
        lapsedRungs: ["instructor", "certified_assistant"],
      }),
    ).toBe(false);
    expect(narrowedByLapse({ shopRoles: ["instructor"] })).toBe(false);
    expect(narrowedByLapse({ shopRoles: ["instructor"], lapsedRungs: [] })).toBe(false);
  });
});

describe("rungLostToLapse", () => {
  it("names the rung the roster gave and the lapse took", () => {
    const both: LapsedRung[] = ["instructor", "certified_assistant"];
    expect(rungLostToLapse({ shopRoles: ["instructor"], lapsedRungs: both })).toBe("instructor");
    // Down one rung, not two: still the instructor rung that was lost.
    expect(rungLostToLapse({ shopRoles: ["instructor"], lapsedRungs: ["instructor"] })).toBe(
      "instructor",
    );
    // A divemaster's lapse is never why a session has no instructor.
    expect(
      rungLostToLapse({ shopRoles: ["divemaster"], lapsedRungs: ["certified_assistant"] }),
    ).toBe("certified_assistant");
    expect(
      rungLostToLapse({ tripRole: "captain", shopRoles: ["divemaster"], lapsedRungs: both }),
    ).toBe(null);
  });
});

describe("countBothClaims", () => {
  it("counts the supervision claim and the roster's claim side by side", () => {
    expect(
      countBothClaims([
        { shopRoles: ["instructor"], lapsedRungs: ["instructor", "certified_assistant"] },
        { shopRoles: ["divemaster"] },
      ]),
    ).toEqual({
      supervision: { instructorCount: 0, assistantCount: 1 },
      roster: { instructorCount: 1, assistantCount: 1 },
    });
  });
});

describe("groupCrewAssignments", () => {
  it("folds one row per held role into one entry per person", () => {
    // The join fan-out is the trap: counting rows would make this person both
    // an instructor and an assistant.
    const grouped = groupCrewAssignments([
      { personId: "p1", tripRole: null, role: "instructor" },
      { personId: "p1", tripRole: null, role: "divemaster" },
      { personId: "p2", tripRole: "captain", role: "divemaster" },
    ]);
    expect(grouped).toHaveLength(2);
    expect(countInWaterCrew(grouped)).toEqual({ instructorCount: 1, assistantCount: 0 });
  });

  it("counts an assistant instructor who is also a divemaster exactly once", () => {
    // The fan-out, on the rung that adds a second way to be an assistant: two
    // join rows for one person, and `assistantCount` is 1 rather than 2.
    const grouped = groupCrewAssignments([
      { personId: "p1", tripRole: null, role: "assistant_instructor" },
      { personId: "p1", tripRole: null, role: "divemaster" },
    ]);
    expect(grouped).toHaveLength(1);
    expect(countInWaterCrew(grouped)).toEqual({ instructorCount: 0, assistantCount: 1 });
  });

  it("keeps a person with no shop-wide role at all — a left join hands back a null role", () => {
    const grouped = groupCrewAssignments([{ personId: "p1", tripRole: "crew", role: null }]);
    expect(grouped).toEqual([{ personId: "p1", tripRole: "crew", shopRoles: [] }]);
    expect(countInWaterCrew(grouped)).toEqual({ instructorCount: 0, assistantCount: 0 });
  });
});

describe("effectiveCrewRoles", () => {
  it("shows the job on this boat when there is one, otherwise the standing roles", () => {
    expect(
      effectiveCrewRoles({ tripRole: "captain", shopRoles: ["divemaster", "captain"] }),
    ).toEqual(["captain"]);
    expect(effectiveCrewRoles({ tripRole: null, shopRoles: ["divemaster", "captain"] })).toEqual([
      "divemaster",
      "captain",
    ]);
  });
});

/**
 * Issue #1852. The documents read after something went wrong ask what rating
 * each professional held, not only what job they did, and an Assistant
 * Instructor rostered as the day's divemaster lost the rating from all of them.
 */
describe("standingRatingsBesideJob", () => {
  it("names the rating the day's job does not already say", () => {
    expect(
      standingRatingsBesideJob({
        tripRole: "divemaster",
        shopRoles: ["divemaster", "assistant_instructor"],
      }),
    ).toEqual(["assistant_instructor"]);
  });

  it("says nothing twice: a divemaster rostered as divemaster carries no rating beside it", () => {
    expect(standingRatingsBesideJob({ tripRole: "divemaster", shopRoles: ["divemaster"] })).toEqual(
      [],
    );
  });

  it("carries nothing when no job is set, since the standing roles already print", () => {
    expect(
      standingRatingsBesideJob({ tripRole: null, shopRoles: ["divemaster", "instructor"] }),
    ).toEqual([]);
  });

  it("prints nothing for somebody whose roles were stripped after they sailed", () => {
    // Never an empty bracket on the document an insurer reads.
    expect(standingRatingsBesideJob({ tripRole: "divemaster", shopRoles: [] })).toEqual([]);
  });

  it("names dive and vessel ratings only, most senior first, never an office", () => {
    expect(
      standingRatingsBesideJob({
        tripRole: "crew",
        shopRoles: ["owner", "captain", "divemaster", "manager", "instructor"],
      }),
    ).toEqual(["instructor", "divemaster", "captain"]);
  });
});
