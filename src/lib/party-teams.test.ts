import { describe, expect, it } from "vitest";
import {
  type PartyDeparture,
  type PartyMember,
  partyAgesUnconfirmed,
  partyLeftReason,
  teamUpRefusal,
} from "./party-teams";

/**
 * **Safety-critical: who one tap may put in the water together** (dive-domain
 * review of layer r5-4, BLOCK 1). Every branch, its boundary ages, and the
 * adversarial shapes a busy morning produces: two children with a parent who
 * is riding, two friends on a Discover Scuba, a teenager whose only adult has
 * no card, a minor nobody wrote a birthday for.
 */

const FUN_DIVE: PartyDeparture = { course: null };
const adult = (overrides: Partial<PartyMember> = {}): PartyMember => ({
  age: 40,
  declaredMinor: false,
  verifiedCard: true,
  ...overrides,
});
const child = (age: number | null, overrides: Partial<PartyMember> = {}): PartyMember => ({
  age,
  declaredMinor: true,
  verifiedCard: true,
  certifications: [{ agency: "padi", juniorStatus: "junior" }],
  ...overrides,
});

describe("partyLeftReason", () => {
  it("lets two or three certified adults team up", () => {
    expect(partyLeftReason(FUN_DIVE, [adult(), adult()])).toBeNull();
    expect(partyLeftReason(FUN_DIVE, [adult(), adult(), adult()])).toBeNull();
  });

  it("lets two adults with no date of birth on file team up", () => {
    expect(partyLeftReason(FUN_DIVE, [adult({ age: null }), adult({ age: null })])).toBeNull();
  });

  it("leaves a party of four or more", () => {
    expect(partyLeftReason(FUN_DIVE, [adult(), adult(), adult(), adult()])).toBe("too_large");
  });

  describe("a course departure", () => {
    it("leaves every party on an intro (DSD, Try Scuba) departure", () => {
      expect(partyLeftReason({ course: { intro: true } }, [adult(), adult()])).toBe("intro_course");
    });

    it("leaves every party of training seats on a course departure", () => {
      expect(partyLeftReason({ course: { intro: false } }, [adult(), adult()])).toBe(
        "training_course",
      );
    });
  });

  describe("a child of ten or eleven", () => {
    it("is left even beside a certified parent", () => {
      expect(partyLeftReason(FUN_DIVE, [adult(), child(10)])).toBe("young_child");
      expect(partyLeftReason(FUN_DIVE, [adult(), child(11)])).toBe("young_child");
    });

    it("leaves two children whose parent is not diving (a rider is not in the party)", () => {
      expect(partyLeftReason(FUN_DIVE, [child(11), child(11)])).toBe("young_child");
    });

    it("leaves a child under ten too", () => {
      expect(partyLeftReason(FUN_DIVE, [adult(), child(9)])).toBe("young_child");
    });

    it("reads age, not the box: a twelve-year-old is a junior, not a young child", () => {
      expect(partyLeftReason(FUN_DIVE, [adult(), child(12)])).toBeNull();
    });
  });

  describe("a junior of twelve to fourteen", () => {
    it("teams up beside a certified adult", () => {
      expect(partyLeftReason(FUN_DIVE, [adult(), child(12)])).toBeNull();
      expect(partyLeftReason(FUN_DIVE, [adult({ age: 18 }), child(14)])).toBeNull();
    });

    it("is left with only another junior", () => {
      expect(partyLeftReason(FUN_DIVE, [child(13), child(14)])).toBe("junior_without_adult");
    });

    it("is left when the adult holds no verified card", () => {
      expect(partyLeftReason(FUN_DIVE, [adult({ verifiedCard: false }), child(13)])).toBe(
        "junior_without_adult",
      );
    });

    it("is left when the oldest is seventeen", () => {
      expect(partyLeftReason(FUN_DIVE, [child(17), child(14)])).toBe("junior_without_adult");
    });

    it("is left when the adult's age is not on file", () => {
      expect(partyLeftReason(FUN_DIVE, [adult({ age: null }), child(13)])).toBe(
        "mixed_ages_unconfirmed",
      );
    });

    it("is left in a party of three whose third certified diver is under eighteen", () => {
      expect(
        partyLeftReason(FUN_DIVE, [adult({ verifiedCard: false }), child(16), child(14)]),
      ).toBe("junior_without_adult");
    });
  });

  it("lets two fifteen-year-olds team up, as the junior bands allow", () => {
    expect(partyLeftReason(FUN_DIVE, [child(15), child(15)])).toBeNull();
  });

  it("leaves a minor with no date of birth, whose band nobody knows", () => {
    expect(partyLeftReason(FUN_DIVE, [adult(), child(null)])).toBe("minor_age_unknown");
  });

  it("leaves known teens with an unknown-age diver instead of asking to confirm everyone is adult", () => {
    for (const age of [15, 17]) {
      for (const requireAdultForTeens of [false, true]) {
        const party = [child(age), adult({ age: null }), adult()];
        expect(partyLeftReason({ course: null, requireAdultForTeens }, party)).toBe(
          "mixed_ages_unconfirmed",
        );
      }
    }
  });

  describe("a party of four or more (second pass, F2)", () => {
    it("says the child before the size: whoever splits it by hand must know", () => {
      expect(partyLeftReason(FUN_DIVE, [adult(), adult(), child(13), child(10)])).toBe(
        "young_child",
      );
    });

    it("says the junior with no certified adult before the size", () => {
      expect(
        partyLeftReason(FUN_DIVE, [adult({ verifiedCard: false }), adult(), child(13), child(14)]),
      ).toBe("too_large");
      expect(
        partyLeftReason(FUN_DIVE, [
          adult({ verifiedCard: false }),
          adult({ verifiedCard: false }),
          child(13),
          child(14),
        ]),
      ).toBe("junior_without_adult");
    });
  });

  describe('an "Under 18" box and a date of birth that disagree (second pass, N5)', () => {
    it("leaves the party: which one is wrong decides who its adult is", () => {
      expect(partyLeftReason(FUN_DIVE, [adult(), child(40)])).toBe("minor_age_conflict");
      expect(partyLeftReason(FUN_DIVE, [child(13), child(19)])).toBe("minor_age_conflict");
    });

    it("is not raised by a minor whose date of birth agrees", () => {
      expect(partyLeftReason(FUN_DIVE, [adult(), child(17)])).toBeNull();
    });
  });

  it("says the course before anything else about the party", () => {
    expect(
      partyLeftReason({ course: { intro: true } }, [child(10), child(11), adult(), adult()]),
    ).toBe("intro_course");
  });
});

/**
 * **Safety-critical: a party nobody has said is adult** (issue 2808). With no
 * date of birth and no "Under 18" box, a seat reads as an adult to
 * `partyLeftReason`, so two undeclared thirteen-year-olds would pass it. One
 * tap teams such a party only after a staffer confirms everyone in it is 18 or
 * over; this says which parties need that.
 */
describe("partyAgesUnconfirmed", () => {
  it("asks about two divers with no date of birth and no box: they could be thirteen", () => {
    expect(partyAgesUnconfirmed([adult({ age: null }), adult({ age: null })])).toBe(true);
  });

  it("asks when only one member is undeclared, even beside a certified adult of forty", () => {
    expect(partyAgesUnconfirmed([adult(), adult({ age: null })])).toBe(true);
    expect(partyAgesUnconfirmed([adult(), adult(), adult({ age: null })])).toBe(true);
  });

  it("asks whatever card the undeclared member holds: a card says nothing about age", () => {
    expect(partyAgesUnconfirmed([adult(), adult({ age: null, verifiedCard: true })])).toBe(true);
  });

  it("does not ask when every member has a date of birth", () => {
    expect(partyAgesUnconfirmed([adult(), adult({ age: 18 })])).toBe(false);
    expect(partyAgesUnconfirmed([child(15), child(15)])).toBe(false);
  });

  it("does not ask about a ticked box: that seat is a minor, and partyLeftReason places it", () => {
    expect(partyAgesUnconfirmed([adult(), child(null)])).toBe(false);
    expect(partyLeftReason(FUN_DIVE, [adult(), child(null)])).toBe("minor_age_unknown");
  });

  it("asks about every party partyLeftReason clears with an undeclared member", () => {
    const party = [adult({ age: null }), adult({ age: null })];
    expect(partyLeftReason(FUN_DIVE, party)).toBeNull();
    expect(partyAgesUnconfirmed(party)).toBe(true);
  });
});

/**
 * Issue 2808: a tap that teamed nobody while a party waited on its tick says
 * so, so the staffer is never left guessing why nothing happened.
 */
describe("teamUpRefusal", () => {
  it("asks for a tick when nothing was teamed and a party waits on one", () => {
    expect(teamUpRefusal(0, 1)).toBe("confirm-adults");
  });

  it("says nothing when the tap teamed someone, or nobody was waiting", () => {
    expect(teamUpRefusal(1, 1)).toBeNull();
    expect(teamUpRefusal(0, 0)).toBeNull();
    expect(teamUpRefusal(2, 0)).toBeNull();
  });
});

/** The card's junior/full state is a staff sighting, not something age proves. */
describe("agency-specific junior safeguards", () => {
  const sighted = (age: number, agency: string, juniorStatus: "junior" | "full" | null) => ({
    ...child(age),
    certifications: [{ agency, juniorStatus }],
  });
  const withTeenPolicy = { course: null, requireAdultForTeens: true };

  it("leaves an unclassified PADI card for review at any age, even beside a full card", () => {
    for (const age of [15, 17, 25]) {
      for (const requireAdultForTeens of [false, true]) {
        const diver = {
          ...adult({ age }),
          certifications: [
            { agency: "padi", juniorStatus: "full" as const },
            { agency: "padi", juniorStatus: null },
          ],
        };
        expect(partyLeftReason({ course: null, requireAdultForTeens }, [adult(), diver])).toBe(
          "junior_requirements_unconfirmed",
        );
      }
    }
  });

  it("leaves a NAUI junior for staff to check the guardian-selected buddy", () => {
    expect(partyLeftReason(FUN_DIVE, [adult(), sighted(13, "naui", "junior")])).toBe(
      "junior_requirements_unconfirmed",
    );
  });

  it("leaves an SDI junior even with a certified adult when their relationship is unknown", () => {
    expect(partyLeftReason(FUN_DIVE, [adult(), sighted(14, "sdi", "junior")])).toBe(
      "junior_requirements_unconfirmed",
    );
  });

  it("does not assume a NAUI junior card was upgraded at 15 or 18", () => {
    for (const age of [15, 18, 25]) {
      const diver = { ...adult({ age }), certifications: [{ agency: "naui", juniorStatus: null }] };
      expect(partyLeftReason(FUN_DIVE, [adult(), diver])).toBe("junior_requirements_unconfirmed");
    }
  });

  it("leaves a known junior card in place after age 18 until its full replacement is verified", () => {
    const diver = {
      ...adult({ age: 25 }),
      certifications: [{ agency: "naui", juniorStatus: "junior" as const }],
    };
    expect(partyLeftReason(FUN_DIVE, [adult(), diver])).toBe("junior_requirements_unconfirmed");
  });

  it("leaves a minor when no verified agency is on file", () => {
    const diver = { ...child(13, { verifiedCard: false }), certifications: [] };
    expect(partyLeftReason(FUN_DIVE, [adult(), diver])).toBe("junior_requirements_unconfirmed");
  });

  it("does not let another agency's full card hide an unconfirmed junior card", () => {
    const diver = {
      ...child(13),
      certifications: [
        { agency: "padi", juniorStatus: "full" as const },
        { agency: "naui", juniorStatus: "junior" as const },
      ],
    };
    expect(partyLeftReason(FUN_DIVE, [adult(), diver])).toBe("junior_requirements_unconfirmed");
  });

  it("leaves BSAC juniors when the buddy's required qualification is not recorded", () => {
    expect(partyLeftReason(FUN_DIVE, [adult(), sighted(13, "bsac", null)])).toBe(
      "junior_requirements_unconfirmed",
    );
  });

  it("keeps teen buddy policy off by default and applies it only when enabled", () => {
    const party = [sighted(15, "padi", "full"), sighted(17, "padi", "full")];
    expect(partyLeftReason(FUN_DIVE, party)).toBeNull();
    expect(partyLeftReason(withTeenPolicy, party)).toBe("junior_without_adult");
    expect(partyLeftReason(withTeenPolicy, [adult(), ...party])).toBeNull();
  });
});
