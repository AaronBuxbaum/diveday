import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  type StoryNoteBooking,
  seatMayBeFirstDive,
  seatWentToSea,
  storyNotes,
} from "./story-notes";

const t = staffTranslator("en-US");

function seat(
  overrides: {
    status?: string;
    tripStatus?: string;
    rented?: string[];
    rating?: number | null;
    diveMode?: "boat" | "shore" | "pool";
    dock?: "boarded" | "not_boarded" | null;
    afterDive?: "boarded" | "missing_after_dive" | null;
    turnedAwayReason?: string | null;
    turnedAwayAt?: Date | null;
    held?: boolean;
  } = {},
): StoryNoteBooking {
  return {
    booking: {
      id: "b-1",
      status: overrides.status ?? "booked",
      paidRentalKinds: overrides.rented ?? [],
      turnedAwayReason: overrides.turnedAwayReason ?? null,
      turnedAwayAt:
        overrides.turnedAwayAt !== undefined
          ? overrides.turnedAwayAt
          : overrides.turnedAwayReason
            ? TURNED_AWAY_AT
            : null,
      identityUnconfirmedAt: overrides.held ? TURNED_AWAY_AT : null,
    },
    trip: { status: overrides.tripStatus ?? "scheduled", diveMode: overrides.diveMode ?? "boat" },
    reviewRating: overrides.rating ?? null,
    rollCall: { dock: overrides.dock ?? null, afterDive: overrides.afterDive ?? null },
  };
}

const behind = { ahead: false, firstSailed: false };
const TURNED_AWAY_AT = new Date("2026-10-16T07:00:00.000Z");

describe("a seat the desk turned away (H-20261015-who-may-turn-someone)", () => {
  const turnedAway = seat({ status: "no_show", turnedAwayReason: "card" });

  it("says the desk saw them and why, never no-show", () => {
    expect(storyNotes(turnedAway, behind, t, "en-US")).toEqual([
      "seen at the desk, turned away: card",
    ]);
    expect(storyNotes(seat({ status: "no_show" }), behind, t, "en-US")).toEqual(["no-show"]);
  });

  it("says it on a boat that has not left yet, too", () => {
    expect(storyNotes(turnedAway, { ahead: true, firstSailed: false }, t, "en-US")).toEqual([
      "seen at the desk, turned away: card",
    ]);
  });

  it("says it in Spanish", () => {
    expect(storyNotes(turnedAway, behind, staffTranslator("es-ES"), "es-ES")).toEqual([
      "atendido en el mostrador, no embarcó: certificación",
    ]);
  });

  /**
   * Layer 3 review (dde-2 #2): removing the seat afterwards is not the diver
   * cancelling. The story keeps the turn-away and says the seat went after.
   */
  it("reads a turned-away seat removed afterwards as turned away, then removed", () => {
    const removed = seat({ status: "cancelled", turnedAwayReason: "card" });
    expect(storyNotes(removed, behind, t, "en-US")).toEqual([
      "seen at the desk, turned away: card, then removed",
    ]);
    expect(storyNotes(removed, { ahead: true, firstSailed: false }, t, "en-US")).toEqual([
      "seen at the desk, turned away: card, then removed",
    ]);
    expect(storyNotes(removed, behind, staffTranslator("es-ES"), "es-ES")).toEqual([
      "atendido en el mostrador, no embarcó: certificación; después se quitó la reserva",
    ]);
    expect(storyNotes(seat({ status: "cancelled" }), behind, t, "en-US")).toEqual(["canceled"]);
  });

  /**
   * Erasure keeps the fact and clears the category (dde-2 #4): the record
   * still never reads "no-show" over somebody the desk saw.
   */
  it("still says turned away when erasure has cleared the category", () => {
    const erased = seat({ status: "no_show", turnedAwayAt: TURNED_AWAY_AT });
    expect(storyNotes(erased, behind, t, "en-US")).toEqual(["seen at the desk, turned away"]);
    expect(storyNotes(erased, behind, staffTranslator("es-ES"), "es-ES")).toEqual([
      "atendido en el mostrador, no embarcó",
    ]);
  });

  /**
   * Security F1: a held seat sits on the matched person's story on a guess.
   * Nothing about the person at the desk is said there while it stands.
   */
  it("says nothing on a seat still held behind the identity question", () => {
    const held = seat({ status: "no_show", turnedAwayReason: "identity", held: true });
    expect(storyNotes(held, behind, t, "en-US")).toEqual([]);
    expect(storyNotes(held, { ahead: true, firstSailed: false }, t, "en-US")).toEqual([]);
  });
});

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

/**
 * **The crew's word on the boat outranks the booking's status** (dive-domain
 * review of the demo layer). The story read "sailed" off the booking and the
 * trip alone, so a seat the crew marked `not_boarded` at the dock read
 * "sailed", could be the diver's "first dive with us", and was credited with
 * the gear and the stars. The rule is `seatSailed` (src/lib/closeout.ts), the
 * one every count of who the boat carried already reads.
 */
describe("a seat the crew marked ashore at the dock", () => {
  const ashore = seat({ dock: "not_boarded", rented: ["bcd"], rating: 5 });

  it("says it stayed ashore, and is never credited with gear, stars or a first dive", () => {
    expect(storyNotes(ashore, { ahead: false, firstSailed: true }, t, "en-US")).toEqual([
      "stayed ashore",
    ]);
    expect(seatWentToSea(ashore)).toBe(false);
    expect(seatMayBeFirstDive(ashore)).toBe(false);
  });

  it("outranks a booking still marked checked in", () => {
    expect(
      storyNotes(seat({ status: "checked_in", dock: "not_boarded" }), behind, t, "en-US"),
    ).toEqual(["stayed ashore"]);
  });

  it("says it in Spanish too", () => {
    expect(storyNotes(ashore, behind, staffTranslator("es-ES"), "es-ES")).toEqual([
      "se quedó en tierra",
    ]);
  });
});

describe("a seat the crew marked ashore at the dock and counted aboard later", () => {
  const pickedUp = seat({ dock: "not_boarded", afterDive: "boarded", rented: ["bcd"] });

  it("says it joined later, never 'sailed', and is never the first dive", () => {
    expect(
      storyNotes(
        seat({ dock: "not_boarded", afterDive: "boarded" }),
        { ahead: false, firstSailed: true },
        t,
        "en-US",
      ),
    ).toEqual(["joined later"]);
    expect(seatWentToSea(pickedUp)).toBe(false);
    expect(seatMayBeFirstDive(pickedUp)).toBe(false);
  });

  it("keeps the gear rented and the stars given, and still no first-dive credit", () => {
    const rated = seat({ dock: "not_boarded", afterDive: "boarded", rented: ["bcd"], rating: 5 });
    const notes = storyNotes(rated, { ahead: false, firstSailed: true }, t, "en-US");
    expect(notes[0]).toBe("joined later");
    expect(notes).toHaveLength(3);
    expect(notes.join(" ")).not.toMatch(/first dive/i);
  });

  it("gives a seat that stayed ashore, or never counted aboard later, no gear or stars", () => {
    const ashore = seat({ dock: "not_boarded", rented: ["bcd"], rating: 5 });
    expect(storyNotes(ashore, behind, t, "en-US")).toEqual(["stayed ashore"]);
  });
});

describe("what the crew's silence and their after-dive word say", () => {
  it("counts a seat nobody spoke for as sailed, per the glossary", () => {
    expect(seatWentToSea(seat())).toBe(true);
    expect(seatMayBeFirstDive(seat())).toBe(true);
  });

  it("counts a seat boarded at the dock as sailed, over the desk's no-show", () => {
    const boarded = seat({ status: "no_show", dock: "boarded" });
    expect(storyNotes(boarded, behind, t, "en-US")).toEqual(["sailed"]);
    expect(seatWentToSea(boarded)).toBe(true);
  });

  it("counts a diver recorded missing after a dive as sailed, but never as a first dive", () => {
    const missing = seat({ afterDive: "missing_after_dive" });
    expect(seatWentToSea(missing)).toBe(true);
    expect(seatMayBeFirstDive(missing)).toBe(false);
  });

  it("says a diver recorded missing after a dive was not counted back aboard, with no credit", () => {
    const missing = seat({ afterDive: "missing_after_dive", rented: ["bcd"], rating: 5 });
    const firstSailed = { ahead: false, firstSailed: true };
    expect(storyNotes(missing, firstSailed, t, "en-US")).toEqual(["not counted back aboard"]);
    expect(storyNotes(missing, firstSailed, staffTranslator("es-ES"), "es-ES")).toEqual([
      "no se contó de vuelta a bordo",
    ]);
  });
});

describe("a trip that is not a boat", () => {
  it("says the diver dived, not sailed, on a pool session or a shore dive", () => {
    expect(storyNotes(seat({ diveMode: "pool" }), behind, t, "en-US")).toEqual(["dived"]);
    expect(storyNotes(seat({ diveMode: "shore" }), behind, t, "en-US")).toEqual(["dived"]);
    expect(
      storyNotes(seat({ diveMode: "pool" }), behind, staffTranslator("es-ES"), "es-ES"),
    ).toEqual(["buceó"]);
  });

  it("says a diver recorded out of a pool session did not dive, not that they stayed ashore", () => {
    expect(storyNotes(seat({ diveMode: "pool", dock: "not_boarded" }), behind, t, "en-US")).toEqual(
      ["did not dive"],
    );
  });
});
