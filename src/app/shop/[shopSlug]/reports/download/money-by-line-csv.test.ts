import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { moneyByLineCsv } from "./money-by-line-csv";

/** The month's CSV carries the same lines, in the same words, as the page (issue #2305). */
describe("moneyByLineCsv", () => {
  const money = (cents: number) => `$${cents / 100}`;

  it("writes one row per line, named as the page names it", () => {
    const csv = moneyByLineCsv(
      [
        { line: "funDives", cents: 18_000 },
        { line: "imported", cents: 40_000 },
      ],
      staffTranslator("en-US"),
      money,
    );
    expect(csv.split("\r\n")).toEqual([
      '"Money in, by line",This month',
      "Fun dives and trips,$180",
      "Unverified imported history,$400",
      "",
    ]);
  });

  it("writes the heading alone for a month with none", () => {
    expect(moneyByLineCsv([], staffTranslator("en-US"), money)).toBe(
      '"Money in, by line",This month\r\n',
    );
  });
});
