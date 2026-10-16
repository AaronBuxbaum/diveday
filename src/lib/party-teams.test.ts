import { describe, expect, it } from "vitest";
import { type PartyDeparture, type PartyMember, partyLeftReason } from "./party-teams";

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
        "junior_without_adult",
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

  it("says the course before anything else about the party", () => {
    expect(
      partyLeftReason({ course: { intro: true } }, [child(10), child(11), adult(), adult()]),
    ).toBe("intro_course");
  });
});
