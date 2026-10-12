import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { type StoryNoteBooking, seatWentToSea, storyNotes } from "./story-notes";

const t = staffTranslator("en-US");

function seat(
  overrides: {
    status?: string;
    tripStatus?: string;
    rented?: string[];
    rating?: number | null;
  } = {},
): StoryNoteBooking {
  return {
    booking: {
      id: "b-1",
      status: overrides.status ?? "booked",
      paidRentalKinds: overrides.rented ?? [],
    },
    trip: { status: overrides.tripStatus ?? "scheduled" },
    reviewRating: overrides.rating ?? null,
  };
}

const behind = { ahead: false, firstSailed: false };

describe("what a seat behind the diver says", () => {
  it("falls back to 'sailed' for a trip that went as trips go", () => {
    expect(storyNotes(seat(), behind, t, "en-US")).toEqual(["sailed"]);
  });

  it("names the first dive with the shop, the gear rented, and the stars given, instead", () => {
    expect(
      storyNotes(
        seat({ rented: ["wetsuit", "bcd"], rating: 4 }),
        { ahead: false, firstSailed: true },
        t,
        "en-US",
      ),
    ).toEqual(["first dive with us", "rented Wetsuit and BCD", "rated it 4 of 5"]);
  });

  it("ignores a stored rental code the catalog no longer knows", () => {
    expect(storyNotes(seat({ rented: ["jetpack"] }), behind, t, "en-US")).toEqual(["sailed"]);
  });

  it("never calls a seat that did not go to sea 'sailed'", () => {
    expect(storyNotes(seat({ status: "cancelled" }), behind, t, "en-US")).toEqual(["canceled"]);
    expect(storyNotes(seat({ tripStatus: "cancelled" }), behind, t, "en-US")).toEqual([
      "trip called off",
    ]);
    expect(storyNotes(seat({ status: "no_show" }), behind, t, "en-US")).toEqual(["no-show"]);
  });

  it("does not credit a canceled seat with gear or stars", () => {
    expect(
      storyNotes(seat({ status: "cancelled", rented: ["bcd"], rating: 5 }), behind, t, "en-US"),
    ).toEqual(["canceled"]);
  });
});

describe("a seat still ahead", () => {
  it("says nothing: whether the diver is ready is the status ledger's question", () => {
    expect(
      storyNotes(seat({ rented: ["bcd"] }), { ahead: true, firstSailed: false }, t, "en-US"),
    ).toEqual([]);
  });
});

describe("which seats count toward the first dive", () => {
  it("counts a seat that went out, and none that did not", () => {
    expect(seatWentToSea(seat())).toBe(true);
    expect(seatWentToSea(seat({ status: "checked_in" }))).toBe(true);
    expect(seatWentToSea(seat({ status: "cancelled" }))).toBe(false);
    expect(seatWentToSea(seat({ status: "no_show" }))).toBe(false);
    expect(seatWentToSea(seat({ tripStatus: "cancelled" }))).toBe(false);
  });
});
