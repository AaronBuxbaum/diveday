import { describe, expect, it } from "vitest";
import { typeChangedDeskEventKind } from "./desk-events";
import { gearAssignmentNeeds } from "./gear";
import {
  countParticipants,
  diverSeatLimit,
  hasNonDivers,
  holdsRegisterKind,
  isDiver,
  isParticipantType,
  joinedDiving,
  joinPassengerSplit,
  leftDiving,
  offeredParticipantTypes,
  parsePartyTypes,
  participantPriceCents,
  rentsGear,
  rentsKind,
  SNORKELER_REGISTER_KINDS,
  SNORKELER_RENTABLE_KINDS,
  seatRefusal,
  typeChangeRefusal,
} from "./participant-types";

describe("participant types", () => {
  it("reads an absent type as a diver, the stricter reading", () => {
    expect(isDiver(undefined)).toBe(true);
    expect(isDiver(null)).toBe(true);
    expect(isDiver("diver")).toBe(true);
    expect(isDiver("snorkeler")).toBe(false);
    expect(isDiver("rider")).toBe(false);
    expect(isParticipantType("snorkeller")).toBe(false);
    expect(isParticipantType("rider")).toBe(true);
  });

  it("binds a diver limit only when it is below the boat's capacity", () => {
    expect(diverSeatLimit({ capacity: 12, diverCapacity: null })).toBeNull();
    expect(diverSeatLimit({ capacity: 12, diverCapacity: 12 })).toBeNull();
    expect(diverSeatLimit({ capacity: 12, diverCapacity: 20 })).toBeNull();
    expect(diverSeatLimit({ capacity: 12, diverCapacity: 8 })).toBe(8);
  });

  describe("seatRefusal", () => {
    const trip = { capacity: 10, diverCapacity: 6 };
    it("counts every body against the boat", () => {
      expect(seatRefusal("rider", trip, { aboard: 10, divers: 2 })).toBe("trip_full");
      expect(seatRefusal("snorkeler", trip, { aboard: 9, divers: 6 })).toBeNull();
    });
    it("counts only divers against the diver seats", () => {
      expect(seatRefusal("diver", trip, { aboard: 7, divers: 6 })).toBe("divers_full");
      expect(seatRefusal("diver", trip, { aboard: 7, divers: 5 })).toBeNull();
    });
    it("says a full boat is full before it says the diver seats are", () => {
      expect(seatRefusal("diver", trip, { aboard: 10, divers: 6 })).toBe("trip_full");
    });
    it("refuses an over-full boat rather than trusting the counts to be sane", () => {
      expect(seatRefusal("rider", trip, { aboard: 14, divers: 0 })).toBe("trip_full");
      expect(seatRefusal("diver", trip, { aboard: 0, divers: 9 })).toBe("divers_full");
    });
  });

  it("refuses a type change only when it makes a diver of someone with no diver seat left", () => {
    const trip = { capacity: 10, diverCapacity: 4 };
    const full = { aboard: 10, divers: 4 };
    expect(typeChangeRefusal("snorkeler", "diver", trip, full)).toBe("divers_full");
    expect(typeChangeRefusal("diver", "rider", trip, full)).toBeNull();
    expect(typeChangeRefusal("rider", "snorkeler", trip, full)).toBeNull();
    // The seat already holds its place against the boat.
    expect(typeChangeRefusal("rider", "diver", trip, { aboard: 10, divers: 3 })).toBeNull();
  });

  it("never prices a snorkeler or a rider at the diver's fare", () => {
    const trip = { priceCents: 18000, snorkelerPriceCents: null, riderPriceCents: 2500 };
    expect(participantPriceCents(trip, "diver")).toBe(18000);
    expect(participantPriceCents(trip, "snorkeler")).toBeNull();
    expect(participantPriceCents(trip, "rider")).toBe(2500);
  });

  it("offers a seat publicly only where the shop named its price, and never on a course", () => {
    expect(
      offeredParticipantTypes({ priceCents: 100, snorkelerPriceCents: null, riderPriceCents: 0 }),
    ).toEqual(["diver", "rider"]);
    expect(
      offeredParticipantTypes({
        priceCents: 100,
        snorkelerPriceCents: 50,
        riderPriceCents: 0,
        courseId: "c",
      }),
    ).toEqual(["diver"]);
  });

  it("counts every row, reading an untyped one as a diver", () => {
    const counts = countParticipants([
      { participantType: "diver" },
      { participantType: "rider" },
      {},
      { participantType: "snorkeler" },
    ]);
    expect(counts).toEqual({ diver: 2, snorkeler: 1, rider: 1 });
    expect(hasNonDivers(counts)).toBe(true);
    expect(hasNonDivers({ diver: 4, snorkeler: 0, rider: 0 })).toBe(false);
  });

  it("packs a snorkeler surface kit only, and a rider nothing", () => {
    expect(rentsKind("diver", "bcd")).toBe(true);
    expect(rentsKind("snorkeler", "mask_fins")).toBe(true);
    expect(rentsKind("snorkeler", "bcd")).toBe(false);
    expect(rentsKind("snorkeler", "regulator")).toBe(false);
    expect(rentsKind("rider", "mask_fins")).toBe(false);
    // Boots ride with a wetsuit on the prep list, for a snorkeler too.
    expect(rentsKind("snorkeler", "boots")).toBe(true);
    expect(rentsKind("rider", "boots")).toBe(false);
    expect(rentsGear("rider")).toBe(false);
    expect(rentsGear("snorkeler")).toBe(true);
  });

  describe("parsePartyTypes", () => {
    const trip = { priceCents: 100, snorkelerPriceCents: 50, riderPriceCents: null };
    it("reads a blank answer as a diver's seat", () => {
      expect(parsePartyTypes([null, "", undefined], trip)).toEqual({
        ok: true,
        types: ["diver", "diver", "diver"],
      });
    });
    it("accepts what the departure sells", () => {
      expect(parsePartyTypes(["diver", "snorkeler"], trip)).toEqual({
        ok: true,
        types: ["diver", "snorkeler"],
      });
    });
    it("refuses, at its index, a seat the departure does not sell or a made-up type", () => {
      expect(parsePartyTypes(["diver", "rider"], trip)).toEqual({ ok: false, index: 1 });
      expect(parsePartyTypes(["captain"], trip)).toEqual({ ok: false, index: 0 });
      expect(parsePartyTypes([{ toString: () => "diver" }], trip)).toEqual({ ok: false, index: 0 });
    });
    it("accepts only a diver's seat when there is no trip to read", () => {
      expect(parsePartyTypes(["snorkeler"], null)).toEqual({ ok: false, index: 0 });
      expect(parsePartyTypes([""], null)).toEqual({ ok: true, types: ["diver"] });
    });
  });

  describe("leftDiving", () => {
    it("names the type a seat sold to dive is doing now", () => {
      expect(leftDiving({ participantType: "snorkeler", bookedAs: "diver" })).toBe("snorkeler");
      expect(leftDiving({ participantType: "rider", bookedAs: "diver" })).toBe("rider");
    });

    it("says nothing of a seat still diving, sold as what it is, or with no record of the sale", () => {
      expect(leftDiving({ participantType: "diver", bookedAs: "diver" })).toBeNull();
      expect(leftDiving({ participantType: "rider", bookedAs: "snorkeler" })).toBeNull();
      expect(leftDiving({ participantType: "snorkeler", bookedAs: "snorkeler" })).toBeNull();
      expect(leftDiving({ participantType: "snorkeler" })).toBeNull();
    });
  });
});

describe("joinedDiving", () => {
  it("names what a seat diving now was sold as, and stays quiet otherwise", () => {
    expect(joinedDiving({ participantType: "diver", bookedAs: "snorkeler" })).toBe("snorkeler");
    expect(joinedDiving({ participantType: "diver", bookedAs: "rider" })).toBe("rider");
    expect(joinedDiving({ participantType: "diver", bookedAs: "diver" })).toBeNull();
    expect(joinedDiving({ participantType: "snorkeler", bookedAs: "rider" })).toBeNull();
    expect(joinedDiving({ participantType: "diver" })).toBeNull();
  });
});

describe("holdsRegisterKind", () => {
  it("lets a snorkeler hold exactly the tagged units their rentable kit splits into", () => {
    const expanded = SNORKELER_RENTABLE_KINDS.flatMap((kind) =>
      gearAssignmentNeeds({
        kind: kind as Parameters<typeof gearAssignmentNeeds>[0]["kind"],
        size: null,
      }).map((need) => need.kind),
    );
    expect([...SNORKELER_REGISTER_KINDS].sort()).toEqual([...new Set(expanded)].sort());
    expect(holdsRegisterKind("snorkeler", "mask")).toBe(true);
    expect(holdsRegisterKind("snorkeler", "regulator")).toBe(false);
    expect(holdsRegisterKind("rider", "mask")).toBe(false);
    expect(holdsRegisterKind("diver", "regulator")).toBe(true);
  });
});

describe("joinPassengerSplit", () => {
  const word = (type: string, count: number) => `${count} ${type}`;
  it("leaves out a type nobody is, in the fixed order", () => {
    expect(joinPassengerSplit({ diver: 8, snorkeler: 3, rider: 0 }, word)).toBe(
      "8 diver · 3 snorkeler",
    );
    expect(joinPassengerSplit({ diver: 0, snorkeler: 0, rider: 2 }, word)).toBe("2 rider");
  });
});

describe("typeChangedDeskEventKind", () => {
  it("names the catch-up line for the new type", () => {
    expect(typeChangedDeskEventKind("diver")).toBe("now_diving");
    expect(typeChangedDeskEventKind("snorkeler")).toBe("now_snorkeling");
    expect(typeChangedDeskEventKind("rider")).toBe("now_riding");
  });
});
