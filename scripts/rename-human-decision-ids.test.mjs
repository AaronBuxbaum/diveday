import { describe, expect, it } from "vitest";

import { deriveId, renameText } from "./rename-human-decision-ids.mjs";

// Built from parts so this file carries no citation the guard would read.
const old = (n) => ["H", n].join("-");
const NEW_SEVEN = "H-20260724-payment-deposit-refund-tax";
const NEW_EIGHT = "H-20260724-certification-levels-agency-rules";
const NEW_NINE = "H-20260801-channel-sends-notifications";
const ids = new Map([
  [7, NEW_SEVEN],
  [8, NEW_EIGHT],
  [9, NEW_NINE],
]);
const stems = new Map([[`${old("07")}-payment-deposit-cancellation-refund-tax`, NEW_SEVEN]]);

describe("renameText", () => {
  it("replaces padded and unpadded numbers, and keeps the text around them", () => {
    expect(renameText(`See ${old("07")} and (${old(8)}).`, ids, stems).text).toBe(
      `See ${NEW_SEVEN} and (${NEW_EIGHT}).`,
    );
  });

  it("replaces a file name stem as a whole, not number then slug", () => {
    const text = `[x](${old("07")}-payment-deposit-cancellation-refund-tax.md)`;
    expect(renameText(text, ids, stems).text).toBe(`[x](${NEW_SEVEN}.md)`);
  });

  it("expands a range into a list so no id is lost", () => {
    expect(renameText(`(${old("07")}–${old("09")})`, ids, stems).text).toBe(
      `(${NEW_SEVEN}, ${NEW_EIGHT}, ${NEW_NINE})`,
    );
  });

  it("does nothing the second time", () => {
    const once = renameText(`${old("07")} ${old("08")}–${old("09")}`, ids, stems).text;
    const twice = renameText(once, ids, stems);
    expect(twice.text).toBe(once);
    expect(twice.changed).toBe(false);
  });

  it("reports a number with no decision behind it and leaves it", () => {
    const result = renameText(`${old(99)} and ${old(7)}`, ids, stems);
    expect(result.text).toBe(`${old(99)} and ${NEW_SEVEN}`);
    expect(result.unknown).toEqual([99]);
  });

  it("leaves other prefixes and lowercase classes alone", () => {
    const text = `NH-7 ${old("V")} V-07 h-07`;
    expect(renameText(text, ids, stems).text).toBe(text);
  });
});

describe("deriveId", () => {
  it("dates it by the earliest date in the file and takes four words of the slug", () => {
    const contents = "# x\n\nDecided 2026-08-03; revised 2026-09-01.\n";
    expect(
      deriveId("H-120-checkouts-reach-the-books-fast", contents, "2026-10-07", new Set()),
    ).toBe("H-20260803-checkouts-reach-the-books");
  });

  it("falls back to the commit date when the file has no date", () => {
    expect(deriveId("H-50-per-diver-record-export", "# x\n", "2026-10-07", new Set())).toBe(
      "H-20261007-per-diver-record-export",
    );
  });

  it("lengthens the slug rather than collide", () => {
    const taken = new Set(["H-20261007-per-diver-record-export"]);
    expect(deriveId("H-51-per-diver-record-export-issue", "# x\n", "2026-10-07", taken)).toBe(
      "H-20261007-per-diver-record-export-issue",
    );
  });
});
