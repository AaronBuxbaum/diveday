import { describe, expect, it } from "vitest";
import type { Certification, SpecialtyCertification } from "@/db/schema";
import {
  COUNTER_RENTAL_MAX_DAYS,
  checkCounterRentalWindow,
  counterRentalCardRefusal,
  counterRentalCardSummary,
  counterRentalCoreKinds,
  counterRentalDayRateCents,
  counterRentalDays,
  counterRentalLineCents,
  counterRentalWaiverFlag,
  counterRentalWaiverStanding,
  counterTankFillRefusal,
  isEnrichedFill,
  isLifeSupportKind,
  parseTankFill,
} from "./counter-rentals";
import type { RentalPricing } from "./rentals";

const PRICING: RentalPricing = {
  setCents: 6000,
  perItemCents: { bcd: 1500, regulator: 1800, fins: 800, wetsuit: 1200 },
  nitroxCents: 1000,
};

describe("counterRentalDays", () => {
  it("counts the window inclusively — a same-day rental is one day", () => {
    expect(counterRentalDays("2026-10-08", "2026-10-08")).toBe(1);
    expect(counterRentalDays("2026-10-08", "2026-10-10")).toBe(3);
    expect(counterRentalDays("2026-10-31", "2026-11-01")).toBe(2);
  });
});

describe("checkCounterRentalWindow", () => {
  const today = "2026-10-08";

  it("accepts a window starting today or later", () => {
    expect(checkCounterRentalWindow({ from: today, until: today, todayLocal: today })).toBeNull();
    expect(
      checkCounterRentalWindow({ from: "2026-10-10", until: "2026-10-12", todayLocal: today }),
    ).toBeNull();
  });

  it("refuses an unreadable date or a window that ends before it starts", () => {
    expect(checkCounterRentalWindow({ from: "", until: today, todayLocal: today })).toBe(
      "invalid_window",
    );
    expect(checkCounterRentalWindow({ from: today, until: "2026-02-30", todayLocal: today })).toBe(
      "invalid_window",
    );
    expect(checkCounterRentalWindow({ from: "2026-10-09", until: today, todayLocal: today })).toBe(
      "invalid_window",
    );
  });

  it("refuses a start in the past rather than inventing a unit that is already overdue", () => {
    expect(
      checkCounterRentalWindow({ from: "2026-10-07", until: "2026-10-09", todayLocal: today }),
    ).toBe("starts_in_past");
  });

  it("caps the window, so a mistyped year cannot hold a unit off the wall for a decade", () => {
    const lastAllowed = "2026-11-07";
    expect(counterRentalDays(today, lastAllowed)).toBe(COUNTER_RENTAL_MAX_DAYS);
    expect(
      checkCounterRentalWindow({ from: today, until: lastAllowed, todayLocal: today }),
    ).toBeNull();
    expect(checkCounterRentalWindow({ from: today, until: "2026-11-08", todayLocal: today })).toBe(
      "window_too_long",
    );
    expect(checkCounterRentalWindow({ from: today, until: "2036-10-08", todayLocal: today })).toBe(
      "window_too_long",
    );
  });
});

describe("counterRentalDayRateCents", () => {
  it("reads the shop's own per-piece price for a unit of that kind", () => {
    expect(counterRentalDayRateCents(PRICING, "bcd")).toBe(1500);
    expect(counterRentalDayRateCents(PRICING, "regulator")).toBe(1800);
    expect(counterRentalDayRateCents(PRICING, "wetsuit")).toBe(1200);
  });

  it("prices fins as the mask-and-fins pair and leaves the mask unpriced, so a pair is billed once", () => {
    expect(counterRentalDayRateCents(PRICING, "fins")).toBe(800);
    expect(counterRentalDayRateCents(PRICING, "mask")).toBeNull();
  });

  it("leaves a kind the price list has no word for unpriced, never zero", () => {
    expect(counterRentalDayRateCents(PRICING, "tank")).toBeNull();
    expect(counterRentalDayRateCents(PRICING, "boots")).toBeNull();
    expect(counterRentalDayRateCents(PRICING, "other")).toBeNull();
    // A rentable kind this shop has not priced.
    expect(counterRentalDayRateCents(PRICING, "dive_computer")).toBeNull();
  });
});

describe("counterRentalLineCents", () => {
  it("multiplies the day rate by the days in the window", () => {
    expect(counterRentalLineCents(PRICING, "bcd", 3)).toBe(4500);
    expect(counterRentalLineCents(PRICING, "regulator", 1)).toBe(1800);
  });

  it("stays null for an unpriced kind, so the form leaves the box for the staffer", () => {
    expect(counterRentalLineCents(PRICING, "tank", 3)).toBeNull();
  });
});

function card(overrides: Partial<Certification> = {}): Certification {
  return {
    level: "open_water",
    status: "verified",
    selfDeclaredAt: null,
    ...overrides,
  } as Certification;
}

function specialty(overrides: Partial<SpecialtyCertification> = {}): SpecialtyCertification {
  return {
    specialty: "drysuit",
    status: "verified",
    importedAt: null,
    reviewedAt: null,
    ...overrides,
  } as SpecialtyCertification;
}

const NO_CARDS = { certifications: [], specialtyCertifications: [] };

describe("counterRentalCardRefusal", () => {
  it("lends soft goods to anybody, card or none", () => {
    expect(
      counterRentalCardRefusal(["fins", "mask", "wetsuit", "weights", "torch"], NO_CARDS),
    ).toBe(null);
  });

  it("refuses every life-support kind without a verified card", () => {
    for (const kind of [
      "regulator",
      "bcd",
      "tank",
      "dive_computer",
      "drysuit",
      "dpv",
      "o2_kit",
      "nitrox_analyzer",
    ] as const) {
      expect(isLifeSupportKind(kind)).toBe(true);
      expect(counterRentalCardRefusal(["fins", kind], NO_CARDS)).toBe("not_certified");
    }
  });

  it("is not cleared by a pending card or a self-declaration", () => {
    const pending = card({ status: "pending" });
    const declared = card({ status: "pending", selfDeclaredAt: new Date("2026-10-01") });
    expect(
      counterRentalCardRefusal(["regulator"], {
        certifications: [pending, declared],
        specialtyCertifications: [],
      }),
    ).toBe("not_certified");
  });

  it("lends life support on a verified card, and asks a drysuit for its own card", () => {
    const cards = { certifications: [card()], specialtyCertifications: [] };
    expect(counterRentalCardRefusal(["regulator", "bcd"], cards)).toBe(null);
    expect(counterRentalCardRefusal(["drysuit"], cards)).toBe("no_drysuit_card");
    expect(
      counterRentalCardRefusal(["drysuit"], {
        ...cards,
        specialtyCertifications: [specialty({ status: "pending" })],
      }),
    ).toBe("no_drysuit_card");
    expect(
      counterRentalCardRefusal(["drysuit"], {
        ...cards,
        specialtyCertifications: [specialty()],
      }),
    ).toBe(null);
  });
});

describe("counterRentalCardSummary", () => {
  it("names the highest verified level and counts the cards that do not count yet", () => {
    expect(
      counterRentalCardSummary({
        certifications: [
          card(),
          card({ level: "rescue" }),
          card({ level: "instructor", status: "pending" }),
        ],
        specialtyCertifications: [specialty()],
      }),
    ).toEqual({ verifiedLevel: "rescue", drysuit: true, unverified: 1 });
    expect(counterRentalCardSummary(NO_CARDS)).toEqual({
      verifiedLevel: null,
      drysuit: false,
      unverified: 0,
    });
  });
});

describe("the set price", () => {
  const core = counterRentalCoreKinds(["bcd", "regulator", "wetsuit", "fins"]);

  it("reads the core set from what the shop offers, fins carrying the pair", () => {
    expect(core).toEqual(["bcd", "regulator", "wetsuit", "fins"]);
  });
});

/**
 * **The counter's waiver line** (issue #2261, H-20261008-counter-rental-waiver-informs): informs, never gates.
 * Only a current signature says nothing; a link is offered only where another
 * link is the fix.
 */
describe("counterRentalWaiverFlag", () => {
  it.each([
    ["current", null],
    ["none", { offerLink: true }],
    ["expired", { offerLink: true }],
    ["guardian_missing", { offerLink: true }],
    ["medical_review", { offerLink: false }],
    ["medical_not_cleared", { offerLink: false }],
  ] as const)("reads %s as %o", (state, expected) => {
    expect(counterRentalWaiverFlag(state)).toEqual(expected);
  });
});

/**
 * Issue #2540: the Rentals list carries the standing's two warning dates
 * beside its state, so it can say what the ticket says.
 */
describe("counterRentalWaiverStanding", () => {
  const signed = {
    state: "current" as const,
    recordId: "w-1",
    signedAt: new Date("2026-09-01T15:00:00Z"),
    expiresAt: new Date("2027-09-01T15:00:00Z"),
    runsOutBeforeTrip: false,
  };

  it("carries an earlier refusal and an open referral as days, and nothing else", () => {
    expect(
      counterRentalWaiverStanding(
        {
          ...signed,
          medical: {
            at: new Date("2026-09-01T15:00:00Z"),
            overriddenRefusal: {
              recordId: "r-1",
              personId: "p-1",
              at: new Date("2026-07-18T15:00:00Z"),
              evaluatedOn: "2026-07-18",
            },
            overriddenReferral: null,
            overriddenReferralAt: new Date("2026-07-20T15:00:00Z"),
          } as never,
        },
        "America/New_York",
      ),
    ).toEqual({ state: "current", refusedOn: "2026-07-18", referredOn: "2026-07-20" });
  });

  it("is the bare state otherwise", () => {
    expect(counterRentalWaiverStanding({ ...signed, medical: null }, "America/New_York")).toEqual({
      state: "current",
    });
    expect(counterRentalWaiverStanding({ state: "none" }, "America/New_York")).toEqual({
      state: "none",
    });
  });
});

describe("tank fills (#2257)", () => {
  it("reads blank as not recorded, air as 21, and a whole percent in range as itself", () => {
    expect(parseTankFill("")).toBeNull();
    expect(parseTankFill("  ")).toBeNull();
    expect(parseTankFill("Air")).toBe(21);
    expect(parseTankFill("21")).toBe(21);
    expect(parseTankFill(" 32 ")).toBe(32);
    expect(parseTankFill("40")).toBe(40);
  });

  it.each(["20", "41", "100", "32.5", "32%", "-32", "eanx", "1e1", "0x20", "3"])(
    "refuses %s rather than guess a mix",
    (raw) => {
      expect(parseTankFill(raw)).toBe("invalid");
    },
  );

  it("lets air through without a nitrox card", () => {
    expect(counterTankFillRefusal([{ kind: "tank", o2Percent: 21 }], false)).toBeNull();
  });

  it("refuses any enriched tank without a nitrox card, even beside air", () => {
    expect(
      counterTankFillRefusal(
        [
          { kind: "tank", o2Percent: 21 },
          { kind: "tank", o2Percent: 22 },
        ],
        false,
      ),
    ).toBe("no_nitrox_card");
    expect(counterTankFillRefusal([{ kind: "tank", o2Percent: 32 }], true)).toBeNull();
  });

  it("refuses a fill on anything but a tank, and out-of-range or fractional percents", () => {
    expect(counterTankFillRefusal([{ kind: "regulator", o2Percent: 21 }], true)).toBe(
      "fill_not_tank",
    );
    for (const o2Percent of [20, 41, 32.5, Number.NaN]) {
      expect(counterTankFillRefusal([{ kind: "tank", o2Percent }], true)).toBe("fill_invalid");
    }
  });

  it("calls only above 21 enriched", () => {
    expect(isEnrichedFill(21)).toBe(false);
    expect(isEnrichedFill(22)).toBe(true);
  });
});
