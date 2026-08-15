import { describe, expect, it } from "vitest";
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
    profile: level === "unknown" ? null : { level },
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
      "advanced_open_water",
    );

    expect(review.total).toBe(5);
    expect(review.below).toBe(1);
    expect(review.notSaid).toBe(2);
  });

  it("counts a diver at the bar as meeting it, never below it", () => {
    const review = reviewLastMinuteRecipients(
      [recipient("Hana", "advanced_open_water")],
      "advanced_open_water",
    );

    expect(review.below).toBe(0);
  });

  it("puts nobody below a trip that asks for no level, however junior the list", () => {
    const review = reviewLastMinuteRecipients(
      [recipient("Ravi", "open_water"), recipient("Amara", null)],
      null,
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
      "advanced_open_water",
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
      "advanced_open_water",
    );

    // Ravi before Naledi (their send order), both before everyone else; the
    // rest keep theirs too. A "said nothing" recipient is *not* lifted — the
    // summary states that count in words, and lifting it would push the names
    // a staffer can actually act on down the page.
    expect(review.shown.map((r) => r.name)).toEqual(["Ravi", "Naledi", "Hana", "Amara", "Petra"]);
  });

  it("caps the drawn list and counts the remainder", () => {
    const many = Array.from({ length: 14 }, (_, index) =>
      recipient(`diver-${index}`, "advanced_open_water"),
    );

    const review = reviewLastMinuteRecipients(many, "open_water", 4);

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

    const review = reviewLastMinuteRecipients(many, "rescue", 2);

    expect(review.shown.map((r) => r.name)).toEqual(["Ravi", "instructor-0"]);
    expect(review.hidden).toBe(10);
    expect(review.below).toBe(1);
  });

  it("draws everyone when the list is shorter than the default range", () => {
    const many = Array.from({ length: LAST_MINUTE_RECIPIENT_PREVIEW_LIMIT }, (_, index) =>
      recipient(`diver-${index}`, "open_water"),
    );

    const review = reviewLastMinuteRecipients(many, "open_water");

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
