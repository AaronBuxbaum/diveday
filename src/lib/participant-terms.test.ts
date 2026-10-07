import { describe, expect, it } from "vitest";
import { MAX_PRICE_MINOR_UNITS } from "./money";
import { parseParticipantTerms } from "./participant-terms";

const usd = { currency: "usd", capacity: 12 };

describe("parseParticipantTerms", () => {
  it("reads blank boxes as not stated", () => {
    expect(
      parseParticipantTerms({ snorkelerPrice: "", riderPrice: null, diverSeats: " " }, usd),
    ).toEqual({
      ok: true,
      patch: { snorkelerPriceCents: null, riderPriceCents: null, diverCapacity: null },
    });
  });

  it("stores prices in the shop's minor units, zero included", () => {
    expect(
      parseParticipantTerms({ snorkelerPrice: "45.5", riderPrice: "0", diverSeats: "8" }, usd),
    ).toEqual({
      ok: true,
      patch: { snorkelerPriceCents: 4550, riderPriceCents: 0, diverCapacity: 8 },
    });
    expect(
      parseParticipantTerms(
        { snorkelerPrice: "5000", riderPrice: "", diverSeats: "" },
        { currency: "jpy", capacity: 12 },
      ),
    ).toMatchObject({ ok: true, patch: { snorkelerPriceCents: 5000 } });
  });

  it("refuses anything that is not a real amount or count", () => {
    for (const fields of [
      { snorkelerPrice: "-1", riderPrice: "", diverSeats: "" },
      { snorkelerPrice: "abc", riderPrice: "", diverSeats: "" },
      { snorkelerPrice: String(MAX_PRICE_MINOR_UNITS), riderPrice: "", diverSeats: "" },
      { snorkelerPrice: "", riderPrice: "", diverSeats: "0" },
      { snorkelerPrice: "", riderPrice: "", diverSeats: "2.5" },
      { snorkelerPrice: "", riderPrice: "", diverSeats: "61" },
    ]) {
      expect(
        parseParticipantTerms(fields, { currency: "usd", capacity: 60 }),
        JSON.stringify(fields),
      ).toEqual({
        ok: false,
      });
    }
  });

  it("refuses diver seats beyond the boat, and accepts exactly the boat", () => {
    expect(
      parseParticipantTerms({ snorkelerPrice: "", riderPrice: "", diverSeats: "13" }, usd),
    ).toEqual({ ok: false });
    expect(
      parseParticipantTerms({ snorkelerPrice: "", riderPrice: "", diverSeats: "12" }, usd),
    ).toMatchObject({
      ok: true,
      patch: { diverCapacity: 12 },
    });
  });
});
