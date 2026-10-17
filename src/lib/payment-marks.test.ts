import { describe, expect, it } from "vitest";
import {
  heldAfterMark,
  markNeedsWriteOffRight,
  markRetryParams,
  readManualPaymentMark,
  readMarkRetry,
  splitPartyPayment,
} from "./payment-marks";

describe("readManualPaymentMark", () => {
  it("reads money taken: the amount in minor units and the method", () => {
    expect(readManualPaymentMark("paid", "120", "cash", "usd")).toEqual({
      kind: "money",
      amountCents: 12_000,
      method: "cash",
    });
    expect(readManualPaymentMark("deposit_paid", "$54.50", "card", "usd")).toEqual({
      kind: "money",
      amountCents: 5_450,
      method: "card",
    });
  });

  it("reads a Spanish shop's comma decimal, and a zero-decimal currency", () => {
    expect(readManualPaymentMark("paid", "62,50", "other", "eur")).toEqual({
      kind: "money",
      amountCents: 6_250,
      method: "other",
    });
    expect(readManualPaymentMark("paid", "5000", "cash", "jpy")).toEqual({
      kind: "money",
      amountCents: 5_000,
      method: "cash",
    });
  });

  it("calls a paid mark with no amount, or zero, a mark with no money", () => {
    expect(readManualPaymentMark("paid", "", "cash", "usd")).toEqual({ kind: "no_money" });
    expect(readManualPaymentMark("paid", "  ", null, "usd")).toEqual({ kind: "no_money" });
    expect(readManualPaymentMark("deposit_paid", "0", "cash", "usd")).toEqual({
      kind: "no_money",
    });
  });

  it("refuses an amount it cannot read rather than guessing", () => {
    expect(readManualPaymentMark("paid", "abc", "cash", "usd")).toEqual({
      kind: "invalid",
      field: "amount",
    });
    expect(readManualPaymentMark("paid", "-20", "cash", "usd")).toEqual({
      kind: "invalid",
      field: "amount",
    });
    expect(readManualPaymentMark("paid", "99999999", "cash", "usd")).toEqual({
      kind: "invalid",
      field: "amount",
    });
  });

  it("refuses money with no method, or a method that is not one of the three", () => {
    expect(readManualPaymentMark("paid", "120", null, "usd")).toEqual({
      kind: "invalid",
      field: "method",
    });
    expect(readManualPaymentMark("paid", "120", "bitcoin", "usd")).toEqual({
      kind: "invalid",
      field: "method",
    });
  });

  it("ignores amount and method on a status that carries no money", () => {
    for (const status of ["unpaid", "waived", "refunded"] as const) {
      expect(readManualPaymentMark(status, "120", "cash", "usd")).toEqual({ kind: "not_money" });
    }
  });
});

describe("markNeedsWriteOffRight", () => {
  const cash = (amountCents: number) => ({
    kind: "money" as const,
    amountCents,
    method: "cash" as const,
  });

  it("lets anyone record money, and only the write-off right mark a seat paid without any", () => {
    expect(markNeedsWriteOffRight(cash(100), "paid", null)).toBe(false);
    expect(markNeedsWriteOffRight({ kind: "not_money" }, "unpaid", 12_000)).toBe(false);
    expect(markNeedsWriteOffRight({ kind: "no_money" }, "paid", null)).toBe(true);
    expect(markNeedsWriteOffRight({ kind: "no_money" }, "deposit_paid", 12_000)).toBe(true);
  });

  it("calls Paid on less than the balance a write-off of the rest, a cent short included", () => {
    expect(markNeedsWriteOffRight(cash(1), "paid", 12_000)).toBe(true);
    expect(markNeedsWriteOffRight(cash(11_999), "paid", 12_000)).toBe(true);
    expect(markNeedsWriteOffRight(cash(12_000), "paid", 12_000)).toBe(false);
    expect(markNeedsWriteOffRight(cash(15_000), "paid", 12_000)).toBe(false);
  });

  it("lets crew record a part payment as the deposit it is", () => {
    expect(markNeedsWriteOffRight(cash(1), "deposit_paid", 12_000)).toBe(false);
    expect(markNeedsWriteOffRight(cash(5_000), "deposit_paid", 12_000)).toBe(false);
  });
});

describe("heldAfterMark", () => {
  const cash = (amountCents: number) => ({
    kind: "money" as const,
    amountCents,
    method: "cash" as const,
  });
  const handDeposit = {
    status: "deposit_paid",
    amountCents: 5_000,
    provider: null,
    method: "card" as const,
  };

  it("adds a balance to a deposit that was also marked by hand", () => {
    expect(heldAfterMark(handDeposit, "paid", cash(7_000))).toEqual({
      amountCents: 12_000,
      method: "cash",
    });
  });

  it("leaves a checkout's deposit to Reports' own add-back, so it is not counted twice", () => {
    expect(
      heldAfterMark({ ...handDeposit, provider: "stripe", method: null }, "paid", cash(7_000)),
    ).toEqual({ amountCents: 7_000, method: "cash" });
  });

  it("keeps a hand deposit when the rest is written off with a blank Paid mark", () => {
    expect(heldAfterMark(handDeposit, "paid", { kind: "no_money" })).toEqual({
      amountCents: 5_000,
      method: "card",
    });
    expect(heldAfterMark(null, "paid", { kind: "no_money" })).toEqual({
      amountCents: null,
      method: null,
    });
  });

  it("replaces, never adds, when a mark corrects one already made", () => {
    expect(
      heldAfterMark(
        { status: "paid", amountCents: 9_000, provider: null, method: "cash" },
        "paid",
        cash(12_000),
      ),
    ).toEqual({ amountCents: 12_000, method: "cash" });
    expect(heldAfterMark(handDeposit, "deposit_paid", cash(6_000))).toEqual({
      amountCents: 6_000,
      method: "cash",
    });
    expect(heldAfterMark(null, "paid", cash(12_000))).toEqual({
      amountCents: 12_000,
      method: "cash",
    });
  });
});

describe("markRetryParams", () => {
  it("carries the parsed amount in cents, the status and the method", () => {
    expect(markRetryParams("paid", "$45.50", "cash", "usd")).toEqual({
      markStatus: "paid",
      markAmount: "4550",
      markMethod: "cash",
    });
  });

  it("drops what it cannot read instead of repeating it", () => {
    expect(markRetryParams("deposit_paid", "lots", "barter", "usd")).toEqual({
      markStatus: "deposit_paid",
      markAmount: undefined,
      markMethod: undefined,
    });
    expect(markRetryParams("paid", "-5", null, "usd").markAmount).toBeUndefined();
    expect(markRetryParams("paid", null, "card", "usd").markAmount).toBeUndefined();
  });

  it("is empty for a status that carries no money", () => {
    expect(markRetryParams("waived", "10", "cash", "usd")).toEqual({});
    expect(markRetryParams("unpaid", null, null, "usd")).toEqual({});
  });
});

describe("readMarkRetry", () => {
  it("reads a bounced mark back", () => {
    expect(readMarkRetry({ status: "paid", amount: "4550", method: "card" })).toEqual({
      status: "paid",
      amountCents: 4550,
      method: "card",
    });
  });

  it("is no retry without a money status", () => {
    expect(readMarkRetry({})).toBeNull();
    expect(readMarkRetry({ status: "refunded", amount: "100" })).toBeNull();
  });

  it("falls back to empty on hand-edited values rather than failing", () => {
    expect(readMarkRetry({ status: "deposit_paid", amount: "12.5", method: "<b>" })).toEqual({
      status: "deposit_paid",
      amountCents: null,
      method: null,
    });
    for (const amount of ["0", "-3", "1e9", "9999999999", "abc", ""]) {
      expect(readMarkRetry({ status: "paid", amount })?.amountCents).toBeNull();
    }
  });
});

describe("splitPartyPayment", () => {
  const seat = (bookingId: string, owedCents: number | null, handMarkRefused = false) => ({
    bookingId,
    owedCents,
    handMarkRefused,
  });
  const party = [seat("lead", 12_000), seat("a", 12_000), seat("b", 8_000)];

  it("gives each seat its balance in order when the amount is exactly what is owed", () => {
    expect(splitPartyPayment(32_000, party)).toEqual({
      kind: "split",
      unspentCents: 0,
      shares: [
        { bookingId: "lead", amountCents: 12_000, settles: true },
        { bookingId: "a", amountCents: 12_000, settles: true },
        { bookingId: "b", amountCents: 8_000, settles: true },
      ],
    });
  });

  it("runs out on one seat as a deposit and leaves the later seats alone", () => {
    expect(splitPartyPayment(15_000, party)).toEqual({
      kind: "split",
      unspentCents: 17_000,
      shares: [
        { bookingId: "lead", amountCents: 12_000, settles: true },
        { bookingId: "a", amountCents: 3_000, settles: false },
      ],
    });
  });

  it("never gives a seat more than it owes, and refuses a payment above the party's total", () => {
    expect(splitPartyPayment(32_001, party)).toEqual({ kind: "over", owedCents: 32_000 });
    const split = splitPartyPayment(32_000, party);
    if (split.kind !== "split") throw new Error("expected a split");
    for (const share of split.shares) {
      expect(share.amountCents).toBeLessThanOrEqual(
        party.find((p) => p.bookingId === share.bookingId)?.owedCents ?? 0,
      );
    }
  });

  it("skips seats that owe nothing", () => {
    expect(splitPartyPayment(5_000, [seat("lead", null), seat("a", 0), seat("b", 8_000)])).toEqual({
      kind: "split",
      unspentCents: 3_000,
      shares: [{ bookingId: "b", amountCents: 5_000, settles: false }],
    });
    expect(splitPartyPayment(5_000, [seat("lead", null)])).toEqual({ kind: "nothing_owed" });
    expect(splitPartyPayment(5_000, [])).toEqual({ kind: "nothing_owed" });
  });

  it("refuses the whole party when a seat that owes was paid through DiveDay", () => {
    expect(splitPartyPayment(5_000, [seat("lead", 12_000), seat("a", 4_000, true)])).toEqual({
      kind: "refused",
      bookingId: "a",
    });
    // A provider-backed seat that owes nothing is not in the way.
    expect(splitPartyPayment(5_000, [seat("lead", 12_000), seat("a", null, true)]).kind).toBe(
      "split",
    );
  });
});
