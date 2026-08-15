import { describe, expect, it } from "vitest";
import type { DiveSpecialty } from "@/db/schema";
import {
  generateLastMinutePromoCode,
  isValidLastMinuteDiscountPercent,
  LAST_MINUTE_RECIPIENT_PREVIEW_LIMIT,
  lastMinuteEntryMatchesTripDate,
  orderLastMinuteRecipients,
  reviewLastMinuteRecipients,
} from "./last-minute-list";
import type { CertificationLevel } from "./readiness";

function match(personId: string) {
  return { person: { id: personId } };
}

function recipient(name: string, level: CertificationLevel | null | "unknown") {
  return {
    name,
    // "unknown" is the person nothing at all is on file for — a distinct case
    // from a profile that exists and holds no level, and both must count as
    // "said nothing".
    certification: level === "unknown" ? null : { level, noCertificationDeclared: false },
  };
}

/**
 * The joiner who answered "I'm not certified yet". A third case, and the point
 * of it: they are neither a rung on the ladder nor silence, and folding them
 * into either is what let a shop mail a Discover Scuba customer a certified
 * two-tank charter (ADR 20260814-self-declared-cards).
 */
function uncertified(name: string) {
  return { name, certification: { level: null, noCertificationDeclared: true } };
}

/**
 * The departure's gate, the way the panel holds it — the trip's own requirement
 * folded with its dive sites. A rung, cards, or both: the fold reads all three,
 * because "I hold no card" is below a Deep charter that names no rung.
 */
function requires(
  level: CertificationLevel | null,
  cards: { specialties?: DiveSpecialty[]; nitrox?: boolean } = {},
) {
  return {
    minimumCertificationLevel: level,
    requiredSpecialties: cards.specialties ?? [],
    requiresNitrox: cards.nitrox ?? false,
  };
}

describe("lastMinuteEntryMatchesTripDate", () => {
  it("matches an entry with no dates given against any trip date", () => {
    expect(
      lastMinuteEntryMatchesTripDate({ availableFrom: null, availableUntil: null }, "2026-08-01"),
    ).toBe(true);
  });

  it("matches a trip date inside a bounded window", () => {
    expect(
      lastMinuteEntryMatchesTripDate(
        { availableFrom: "2026-07-25", availableUntil: "2026-08-05" },
        "2026-07-29",
      ),
    ).toBe(true);
  });

  it("rejects a trip date before the window starts", () => {
    expect(
      lastMinuteEntryMatchesTripDate(
        { availableFrom: "2026-08-01", availableUntil: null },
        "2026-07-29",
      ),
    ).toBe(false);
  });

  it("rejects a trip date after the window ends", () => {
    expect(
      lastMinuteEntryMatchesTripDate(
        { availableFrom: null, availableUntil: "2026-07-20" },
        "2026-07-29",
      ),
    ).toBe(false);
  });

  it("includes the boundary dates themselves", () => {
    const window = { availableFrom: "2026-07-29", availableUntil: "2026-07-29" };
    expect(lastMinuteEntryMatchesTripDate(window, "2026-07-29")).toBe(true);
  });
});

describe("isValidLastMinuteDiscountPercent", () => {
  it("accepts integers inside the shop discount range", () => {
    expect(isValidLastMinuteDiscountPercent(50)).toBe(true);
    expect(isValidLastMinuteDiscountPercent(5)).toBe(true);
    expect(isValidLastMinuteDiscountPercent(90)).toBe(true);
  });

  it("rejects out-of-range or non-integer values", () => {
    expect(isValidLastMinuteDiscountPercent(4)).toBe(false);
    expect(isValidLastMinuteDiscountPercent(91)).toBe(false);
    expect(isValidLastMinuteDiscountPercent(50.5)).toBe(false);
    expect(isValidLastMinuteDiscountPercent(0)).toBe(false);
  });
});

describe("orderLastMinuteRecipients", () => {
  it("puts a wait-listed recipient ahead of everyone else", () => {
    const matches = [match("a"), match("b"), match("c")];
    expect(orderLastMinuteRecipients(matches, ["c"])).toEqual([match("c"), match("a"), match("b")]);
  });

  it("orders multiple wait-listed recipients by their own wait-list position", () => {
    const matches = [match("a"), match("b"), match("c")];
    // "b" joined the wait list before "a" did, even though "a" appears first
    // in the last-minute-list's own (unrelated) order.
    expect(orderLastMinuteRecipients(matches, ["b", "a"])).toEqual([
      match("b"),
      match("a"),
      match("c"),
    ]);
  });

  it("leaves the order untouched when nobody on it is wait-listed", () => {
    const matches = [match("a"), match("b"), match("c")];
    expect(orderLastMinuteRecipients(matches, [])).toEqual(matches);
    expect(orderLastMinuteRecipients(matches, ["z"])).toEqual(matches);
  });

  it("keeps everyone else's relative order stable behind the wait-listed group", () => {
    const matches = [match("a"), match("b"), match("c"), match("d")];
    expect(orderLastMinuteRecipients(matches, ["c"])).toEqual([
      match("c"),
      match("a"),
      match("b"),
      match("d"),
    ]);
  });
});

/**
 * The arithmetic behind the one sentence a staffer reads at the send button,
 * and the ordering that makes capping the list safe. Nothing here filters or
 * gates the blast (ADR 20260814-self-declared-cards) — it only decides what
 * gets said and what gets drawn first.
 */
describe("reviewLastMinuteRecipients", () => {
  it("counts who is below the trip's bar and who said nothing", () => {
    const review = reviewLastMinuteRecipients(
      [
        recipient("Ravi", "open_water"),
        recipient("Hana", "advanced_open_water"),
        recipient("Amara", null),
        recipient("Felix", "unknown"),
        recipient("Petra", "rescue"),
      ],
      requires("advanced_open_water"),
    );

    expect(review.total).toBe(5);
    expect(review.below).toBe(1);
    expect(review.notSaid).toBe(2);
  });

  it("counts a stated 'I hold no card' as below the bar, and never as silence", () => {
    const review = reviewLastMinuteRecipients(
      [recipient("Hana", "advanced_open_water"), uncertified("Dee"), recipient("Amara", null)],
      requires("advanced_open_water"),
    );

    // Below every bar there is, without being ranked on a ladder they are not
    // on — and lifted to the top of the capped preview like anyone else who
    // should give a staffer pause. Nothing here filters or reorders the mail.
    expect(review.below).toBe(1);
    expect(review.notSaid).toBe(1);
    expect(review.shown[0]?.recipient.name).toBe("Dee");
    expect(review.shown[0]?.belowRequirement).toBe(true);
  });

  it("puts an uncertified joiner below no bar when the departure sets none", () => {
    const review = reviewLastMinuteRecipients([uncertified("Dee")], null);

    // A departure that asks for nothing has nothing for anybody to be under —
    // the answer still renders on the row, and it is still not a refusal.
    expect(review.below).toBe(0);
    expect(review.notSaid).toBe(0);
    expect(review.shown[0]?.belowRequirement).toBe(false);
  });

  /**
   * **The departure this fold could say nothing about, and now can — once.**
   *
   * A Deep-and-nitrox charter with the level box left blank is an ordinary
   * configuration: the crew thinks about the site's card requirement and never
   * types a rung. Every other recipient here is genuinely unknowable (a missing
   * Deep card cannot be read off a level), and the panel says so in words — but
   * "there is no card" refutes a Deep requirement without any comparison, so the
   * one name the fold *can* place must not be the one it stays silent about.
   */
  it("places the uncertified joiner on a departure gated by cards rather than a rung", () => {
    const review = reviewLastMinuteRecipients(
      [recipient("Hana", "instructor"), uncertified("Dee")],
      requires(null, { specialties: ["deep"], nitrox: true }),
    );

    expect(review.below).toBe(1);
    expect(review.shown[0]?.recipient.name).toBe("Dee");
    // And nobody is invented as below on the strength of a rung nobody typed:
    // the Instructor here holds no Deep card as far as this list knows, and
    // saying so is the summary sentence's job, not a verdict on his row.
    expect(review.shown[1]?.belowRequirement).toBe(false);
  });

  it("counts a diver at the bar as meeting it, never below it", () => {
    const review = reviewLastMinuteRecipients(
      [recipient("Hana", "advanced_open_water")],
      requires("advanced_open_water"),
    );

    expect(review.below).toBe(0);
  });

  it("puts nobody below a trip that asks for no level, however junior the list", () => {
    const review = reviewLastMinuteRecipients(
      [recipient("Ravi", "open_water"), recipient("Amara", null)],
      requires(null),
    );

    // The summary's own no-requirement branch reads off this: a departure with
    // no bar has nothing for a level to be under, and "0 below" would invite
    // the reader to imagine a bar that isn't there.
    expect(review.below).toBe(0);
    expect(review.notSaid).toBe(1);
    expect(review.total).toBe(2);
  });

  it("reports nobody below when the whole list clears the bar", () => {
    const review = reviewLastMinuteRecipients(
      [recipient("Hana", "advanced_open_water"), recipient("Petra", "instructor")],
      requires("advanced_open_water"),
    );

    expect(review.below).toBe(0);
    expect(review.notSaid).toBe(0);
    expect(review.hidden).toBe(0);
  });

  it("lifts everyone below the bar to the top, keeping send order inside each group", () => {
    const review = reviewLastMinuteRecipients(
      [
        recipient("Hana", "advanced_open_water"),
        recipient("Ravi", "open_water"),
        recipient("Amara", null),
        recipient("Naledi", "open_water"),
        recipient("Petra", "instructor"),
      ],
      requires("advanced_open_water"),
    );

    // Ravi before Naledi (their send order), both before everyone else; the
    // rest keep theirs too. A "said nothing" recipient is *not* lifted — the
    // summary states that count in words, and lifting it would push the names
    // a staffer can actually act on down the page.
    expect(review.shown.map((row) => row.recipient.name)).toEqual([
      "Ravi",
      "Naledi",
      "Hana",
      "Amara",
      "Petra",
    ]);
  });

  it("marks each drawn row with whether that person is under the bar", () => {
    const review = reviewLastMinuteRecipients(
      [
        recipient("Ravi", "open_water"),
        recipient("Hana", "advanced_open_water"),
        recipient("Amara", null),
      ],
      requires("advanced_open_water"),
    );

    // The count alone could not tell a row apart from its neighbour, which is
    // how a verified Open Water diver sat in calm muted text on an Advanced
    // departure while the summary underneath counted him.
    expect(review.shown.map((row) => [row.recipient.name, row.belowRequirement])).toEqual([
      ["Ravi", true],
      ["Hana", false],
      ["Amara", false],
    ]);
  });

  it("marks nobody when the departure asks for no level", () => {
    const review = reviewLastMinuteRecipients(
      [recipient("Ravi", "open_water"), recipient("Amara", null)],
      requires(null),
    );

    // No bar, so no row may say anybody is under it — the same rule the
    // summary's own no-requirement branch follows.
    expect(review.shown.every((row) => row.belowRequirement === false)).toBe(true);
  });

  it("caps the drawn list and counts the remainder", () => {
    const many = Array.from({ length: 14 }, (_, index) =>
      recipient(`diver-${index}`, "advanced_open_water"),
    );

    const review = reviewLastMinuteRecipients(many, requires("open_water"), 4);

    expect(review.shown).toHaveLength(4);
    expect(review.hidden).toBe(10);
    expect(review.total).toBe(14);
  });

  it("never lets the cap hide someone below the bar behind someone who clears it", () => {
    // The whole reason a default range is allowed here instead of a `Pager`.
    // The one Open Water diver joined last and would be recipient 12 of 12 in
    // send order; a naive `slice(0, 2)` would draw two Instructors and leave a
    // shop looking at a clean list.
    const many = [
      ...Array.from({ length: 11 }, (_, index) => recipient(`instructor-${index}`, "instructor")),
      recipient("Ravi", "open_water"),
    ];

    const review = reviewLastMinuteRecipients(many, requires("rescue"), 2);

    expect(review.shown.map((row) => row.recipient.name)).toEqual(["Ravi", "instructor-0"]);
    expect(review.hidden).toBe(10);
    expect(review.below).toBe(1);
  });

  it("draws everyone when the list is shorter than the default range", () => {
    const many = Array.from({ length: LAST_MINUTE_RECIPIENT_PREVIEW_LIMIT }, (_, index) =>
      recipient(`diver-${index}`, "open_water"),
    );

    const review = reviewLastMinuteRecipients(many, requires("open_water"));

    expect(review.shown).toHaveLength(LAST_MINUTE_RECIPIENT_PREVIEW_LIMIT);
    expect(review.hidden).toBe(0);
  });
});

describe("generateLastMinutePromoCode", () => {
  it("embeds the discount percent and stays within a typeable length", () => {
    const code = generateLastMinutePromoCode(50);
    expect(code).toMatch(/^SAVE50-[0-9A-F]{6}$/);
  });

  it("generates distinct codes across calls", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateLastMinutePromoCode(25)));
    expect(codes.size).toBe(20);
  });
});
