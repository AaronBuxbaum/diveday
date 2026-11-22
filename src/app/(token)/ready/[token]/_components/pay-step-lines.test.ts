import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import {
  atShopMoneyLine,
  atShopRentalLines,
  packageDiveBreakdown,
  payStepIsPayable,
  payStepLines,
} from "./pay-step-lines";

const t = diverTranslator("en-US");
const money = (cents: number) => `$${cents / 100}`;
const receipt = { amountCents: 18_000, currency: "usd", isDeposit: false, balanceDueCents: 0 };
const none = { left: 0, usedHere: 0 };

describe("payStepLines", () => {
  it("says the figure paid, and nothing about packages to a diver who holds none", () => {
    expect(payStepLines(t, money, receipt, none).paidLine).toBe("$180");
  });

  it("says how many package dives are left beside it", () => {
    expect(payStepLines(t, money, receipt, { left: 1, usedHere: 0 }).paidLine).toBe(
      "$180 · 1 package dive left",
    );
    expect(payStepLines(t, money, receipt, { left: 7, usedHere: 0 }).paidLine).toBe(
      "$180 · 7 package dives left",
    );
  });

  // Fourth UX review item 9; dive-domain review N8 of layer r4-1: what is
  // left, never a total that looks like the card shrank.
  it("says a package dive is a tank, and how many are left", () => {
    expect(payStepLines(t, money, receipt, { left: 6, usedHere: 2 }).paidLine).toBe(
      "$180 · Uses 2 package dives (6 left), one per tank",
    );
    expect(payStepLines(t, money, receipt, { left: 0, usedHere: 1 }).paidLine).toBe(
      "$180 · Uses 1 package dive (0 left), one per tank",
    );
  });

  it("names a deposit's balance still to pay", () => {
    expect(
      payStepLines(t, money, { ...receipt, isDeposit: true, balanceDueCents: 5_000 }, none)
        .depositBalanceLine,
    ).toContain("$50");
    expect(payStepLines(t, money, receipt, none).depositBalanceLine).toBeNull();
  });

  it("says how the shop takes the balance, when it has said", () => {
    const line = payStepLines(
      t,
      money,
      { ...receipt, isDeposit: true, balanceDueCents: 5_000 },
      none,
      "card",
    ).depositBalanceLine;
    expect(line).toMatch(/\$50.* Pay by card when you arrive\.$/);
  });
});

describe("atShopMoneyLine (fourth UX review, item 5)", () => {
  const trip = { priceCents: 9_500, depositCents: null, snorkelerPriceCents: 4_000, course: null };
  const owes = {
    owesAtShop: true,
    participantType: "diver" as const,
    shop: { deskPayment: null },
  };
  const seat = (claimed: boolean) => ({ claimed, participantType: "diver" as const });

  it("says one seat's figure, due at the shop", () => {
    expect(atShopMoneyLine(t, "en-US", "usd", owes, trip, [])).toBe(
      "Your seat: $95.00, due at the shop.",
    );
  });

  it("counts the lead's unclaimed party seats, and leaves a claimed seat to its claimant", () => {
    expect(atShopMoneyLine(t, "en-US", "usd", owes, trip, [seat(false), seat(true)])).toBe(
      "2 seats: $190.00, due at the shop. 1 claimed seat is paid from its own page.",
    );
  });

  it("says how the desk takes money, when the shop has said (ideas item 21)", () => {
    const desk = { ...owes, shop: { deskPayment: "card_and_cash" as const } };
    expect(atShopMoneyLine(t, "en-US", "usd", desk, trip, [])).toBe(
      "Your seat: $95.00, due at the shop. Pay by card or cash when you arrive.",
    );
    expect(atShopMoneyLine(t, "en-US", "usd", desk, trip, [seat(false), seat(true)])).toBe(
      "2 seats: $190.00, due at the shop. 1 claimed seat is paid from its own page. Pay by card or cash when you arrive.",
    );
  });

  it("says nothing when nothing is owed at the shop", () => {
    expect(atShopMoneyLine(t, "en-US", "usd", { ...owes, owesAtShop: false }, trip, [])).toBeNull();
    expect(atShopMoneyLine(t, "en-US", "usd", owes, null, [])).toBeNull();
  });
});

describe("saved rental estimate beside the seat amount", () => {
  const trip = { priceCents: 9_000, depositCents: null, snorkelerPriceCents: 4_000, course: null };
  const data = {
    owesAtShop: true,
    participantType: "diver" as const,
    rentalFit: { fitStatedAt: new Date("2026-01-01T00:00:00Z"), rentsWeights: true },
    wantsNitrox: false,
    shop: {
      rentalItems: ["weights"],
      rentalPricing: { setCents: null, perItemCents: { weights: 4_500 }, nitroxCents: null },
    },
    trip: { plannedDives: 2, course: null },
  };
  it("adds the saved rental to the seat, not a second per-person fare", () => {
    const lines = atShopRentalLines(t, "en-US", "usd", data, trip, []);
    expect(lines).toContain("Your estimated rental: $45.00.");
    expect(lines).toContain(
      "Estimated total at the shop: $135.00. The crew confirms the rental at the dock.",
    );
  });
  it("adds only this diver’s gear to the party fare, never multiplying their fit", () => {
    const lines = atShopRentalLines(t, "en-US", "usd", data, trip, [
      { claimed: false, participantType: "diver" },
      { claimed: true, participantType: "diver" },
    ]);
    expect(lines).toContain(
      "Estimated total at the shop: $225.00. The crew confirms the rental at the dock.",
    );
    expect(lines).toContain(
      "This estimate includes your gear only; other divers’ rentals are extra.",
    );
  });
  it("does not invent an estimate for an unstated fit, paid seat, or included course gear", () => {
    expect(atShopRentalLines(t, "en-US", "usd", { ...data, rentalFit: null }, trip, [])).toEqual(
      [],
    );
    expect(
      atShopRentalLines(
        t,
        "en-US",
        "usd",
        { ...data, rentalFit: { ...data.rentalFit, fitStatedAt: null } },
        trip,
        [],
      ),
    ).toEqual([]);
    expect(atShopRentalLines(t, "en-US", "usd", { ...data, owesAtShop: false }, trip, [])).toEqual(
      [],
    );
    expect(
      atShopRentalLines(
        t,
        "en-US",
        "usd",
        {
          ...data,
          trip: {
            ...data.trip,
            course: { includedRentalKinds: ["weights"], nitroxCompatible: false },
          },
        },
        trip,
        [],
      ),
    ).toEqual([]);
  });
  it("does not conceal selected gear whose price the shop has not published", () => {
    const unpriced = {
      ...data,
      rentalFit: { ...data.rentalFit, rentsBcd: true },
      shop: { ...data.shop, rentalItems: ["weights", "bcd"] },
    };
    expect(atShopRentalLines(t, "en-US", "usd", unpriced, trip, [])).toContain(
      t("ready.rentalEstimateUnpriced"),
    );
  });
  it("discloses an unpriced nitrox fill alongside priced gear", () => {
    const fill = {
      ...data,
      wantsNitrox: true,
      shop: { ...data.shop, rentalItems: ["weights", "nitrox"] },
    };
    expect(atShopRentalLines(t, "en-US", "usd", fill, trip, [])).toContain(
      t("ready.rentalEstimateUnpriced"),
    );
  });
  it("keeps an all-unpriced rental visible without inventing a numeric total", () => {
    const unknown = {
      ...data,
      shop: { ...data.shop, rentalPricing: { ...data.shop.rentalPricing, perItemCents: {} } },
    };
    expect(atShopRentalLines(t, "en-US", "usd", unknown, trip, [])).toEqual([
      t("ready.rentalEstimateUnpricedOnly"),
    ]);
  });
});

it("states promotional fare coverage and remaining credit instead of a zero-dollar cash receipt", () => {
  const line = payStepLines(
    t,
    money,
    { ...receipt, amountCents: 0, tripCredit: { amountCents: 18_000, balanceCents: 5_000 } },
    none,
  );
  expect(line.paidLine).toBe("$180 trip credit applied · $50 credit left");
  expect(line.depositBalanceLine).toBeNull();
});

describe("packageDiveBreakdown (issue 4309)", () => {
  const plain = (text: string) => text.replace(/\u00A0/g, " ");

  it("lists mixed packages by what they cover and when they end, soonest first", () => {
    const breakdown = packageDiveBreakdown(t, "en-US", [
      { scope: "fun_dives", useBy: "2026-12-30", count: 3 },
      { scope: "all", useBy: null, count: 2 },
    ]);
    expect(breakdown?.summary).toBe("Your package dives");
    expect(breakdown?.rows.map(plain)).toEqual([
      "3 dives · Courses not included · Use by Dec 30, 2026",
      "2 dives · Courses included · No expiry date",
    ]);
    // One dive is one tank, and the soonest to end is spent first.
    expect(breakdown?.note).toBe("Used soonest-ending first, one dive per tank.");
  });

  it("opens on one package when it has an end date", () => {
    const breakdown = packageDiveBreakdown(t, "en-US", [
      { scope: "all", useBy: "2027-01-15", count: 4 },
    ]);
    expect(breakdown?.rows.map(plain)).toEqual([
      "4 dives · Courses included · Use by Jan 15, 2027",
    ]);
  });

  it("adds nothing to the compact balance when there is nothing to tell apart", () => {
    // One open-ended package: the "N package dives left" line already says it all.
    expect(
      packageDiveBreakdown(t, "en-US", [{ scope: "fun_dives", useBy: null, count: 5 }]),
    ).toBeNull();
    // Every dive spent or taken back: nothing held, nothing to break down.
    expect(packageDiveBreakdown(t, "en-US", [])).toBeNull();
  });

  it("never says a held total covers a course or holds a seat", () => {
    const breakdown = packageDiveBreakdown(t, "en-US", [
      { scope: "fun_dives", useBy: "2026-12-30", count: 1 },
      { scope: "fun_dives", useBy: null, count: 6 },
    ]);
    const words = plain(
      [breakdown?.summary, ...(breakdown?.rows ?? []), breakdown?.note].join(" "),
    );
    expect(words).not.toMatch(/7/);
    expect(words).not.toMatch(/seat|guarante|reserv/i);
    expect(breakdown?.rows.every((row) => row.includes("Courses not included"))).toBe(true);
  });

  it("speaks Spanish", () => {
    const es = diverTranslator("es-ES");
    const breakdown = packageDiveBreakdown(es, "es-ES", [
      { scope: "fun_dives", useBy: "2026-12-30", count: 1 },
      { scope: "all", useBy: null, count: 2 },
    ]);
    expect(breakdown?.rows.map(plain)[0]).toContain("1 inmersión · No incluye cursos");
    expect(breakdown?.note).toBe("Se usan primero las que vencen antes, una inmersión por tanque.");
  });
});

describe("payStepIsPayable", () => {
  it("asks for money only when the diver can pay and the step owes it", () => {
    expect(payStepIsPayable(true, "payment_due")).toBe(true);
    expect(payStepIsPayable(true, "payment_refunded")).toBe(true);
    expect(payStepIsPayable(false, "payment_due")).toBe(false);
    expect(payStepIsPayable(true, undefined)).toBe(false);
  });
});
