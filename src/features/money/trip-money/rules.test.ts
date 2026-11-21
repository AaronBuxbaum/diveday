import { describe, expect, it } from "vitest";
import { netOfRefund, type TripMoneySeat, tallyTripMoney } from "./rules";

const seat = (over: Partial<TripMoneySeat>): TripMoneySeat => ({
  live: true,
  paymentStatus: null,
  amountCents: null,
  paymentCurrency: null,
  owedCents: null,
  rentalCents: 0,
  ...over,
});

/**
 * **What one departure took and is still owed** (layer E, Wrapped up's Money
 * card): held money only in the states Reports counts, what is left after a
 * partial refund, rentals as their own line, and owed only on live seats.
 */
describe("a departure's money", () => {
  it("adds what each seat holds, its rentals, and what live seats still owe", () => {
    const money = tallyTripMoney(
      [
        seat({
          paymentStatus: "paid",
          amountCents: 15_000,
          paymentCurrency: "usd",
          rentalCents: 3_000,
        }),
        seat({
          paymentStatus: "deposit_paid",
          amountCents: 5_000,
          paymentCurrency: "usd",
          owedCents: 10_000,
        }),
        seat({ paymentStatus: "partly_refunded", amountCents: 7_500, paymentCurrency: "usd" }),
        seat({ owedCents: 15_000 }),
      ],
      "usd",
    );
    expect(money).toEqual({
      currency: "usd",
      collectedCents: 27_500,
      rentalCents: 3_000,
      rentalGuests: 1,
      owedCents: 25_000,
      otherCurrencySeats: 0,
    });
  });

  it("counts nothing a refund gave back, a waiver, or a pending payment", () => {
    const money = tallyTripMoney(
      [
        seat({ paymentStatus: "refunded", amountCents: 0, paymentCurrency: "usd" }),
        seat({ paymentStatus: "waived", amountCents: null, paymentCurrency: "usd" }),
        seat({ paymentStatus: "unpaid", amountCents: 9_000, paymentCurrency: "usd" }),
      ],
      "usd",
    );
    expect(money.collectedCents).toBe(0);
  });

  it("leaves a cancelled seat's balance out of what is owed", () => {
    expect(tallyTripMoney([seat({ live: false, owedCents: 15_000 })], "usd").owedCents).toBe(0);
  });

  it("leaves a cancelled seat's rentals out", () => {
    const money = tallyTripMoney([seat({ live: false, rentalCents: 3_000 })], "usd");
    expect(money).toMatchObject({ rentalCents: 0, rentalGuests: 0 });
  });

  it("takes a refund off the rental money in the share the rentals were of the whole", () => {
    // A $200 checkout with $50 of gear, $100 refunded: half of it is left.
    expect(netOfRefund(5_000, 20_000, 10_000)).toBe(2_500);
    expect(netOfRefund(5_000, 20_000, 0)).toBe(5_000);
    expect(netOfRefund(5_000, 20_000, 20_000)).toBe(0);
    // More refunded than taken never reads as money owed back on gear.
    expect(netOfRefund(5_000, 20_000, 30_000)).toBe(0);
    expect(netOfRefund(0, 0, 0)).toBe(0);
  });

  it("never adds another currency's amount to the shop's", () => {
    const money = tallyTripMoney(
      [seat({ paymentStatus: "paid", amountCents: 10_000, paymentCurrency: "eur" })],
      "USD",
    );
    expect(money.collectedCents).toBe(0);
    expect(money.otherCurrencySeats).toBe(1);
  });
});
