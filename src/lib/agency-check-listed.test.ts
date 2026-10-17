import { describe, expect, it } from "vitest";
import { type AgencyListedKind, judgeAgencyListedCard } from "./agency-check";

const lena = {
  firstName: "Lena",
  lastName: "Ortiz",
  birthDate: "1990-04-12",
  cardNumber: "N-12345",
} as const;

/**
 * **A pending nitrox or specialty card, checked on the agency's page** (issue
 * #2592). It certifies only when the diver's own record lists the card in the
 * agency's words, under the card's number. The adversarial cases are the
 * point: a kind the page does not list, another number, a neighbour's record,
 * a professional rating that contains the card's name, and a limited row.
 */
describe("judgeAgencyListedCard", () => {
  const check = (
    pageText: string,
    kind: AgencyListedKind,
    overrides: Partial<Parameters<typeof judgeAgencyListedCard>[0]> = {},
  ) =>
    judgeAgencyListedCard({
      agency: "ssi",
      kind,
      ...lena,
      birthDate: null,
      today: "2026-10-14",
      pageText,
      ...overrides,
    });
  const SSI = [
    "Online Diver Check",
    "Lena Ortiz",
    "Card N-12345",
    "Open Water Diver",
    "Enriched Air Nitrox 32 · 12.05.2021",
    "Deep Diving",
  ].join("\n");
  const EVIDENCE =
    "Lena Ortiz · Card N-12345 · Open Water Diver · Enriched Air Nitrox 32 · 12.05.2021 · Deep Diving";

  it("matches a nitrox card and a specialty card the diver's record lists, with the diver's own words", () => {
    expect(check(SSI, "nitrox")).toEqual({ verdict: "match", evidence: EVIDENCE });
    expect(check(SSI, "deep")).toEqual({ verdict: "match", evidence: EVIDENCE });
  });

  it("does not match a kind the record does not list, and shows the diver's words", () => {
    expect(check(SSI, "wreck")).toEqual({ verdict: "level_unconfirmed", evidence: EVIDENCE });
  });

  it("does not match from a level card alone", () => {
    const levelOnly = ["Lena Ortiz", "Card N-12345", "Open Water Diver"].join("\n");
    expect(check(levelOnly, "nitrox").verdict).toBe("level_unconfirmed");
  });

  it("does not match under another card's number, even with the birth date right", () => {
    const record = ["Lena Ortiz 04/12/1990", "Card N-77777", "Enriched Air Nitrox"].join("\n");
    expect(check(record, "nitrox", { agency: "naui", birthDate: "1990-04-12" }).verdict).toBe(
      "level_unconfirmed",
    );
    // Without the birth date the number is the only proof, and it is another diver's.
    expect(check(SSI.replace("N-12345", "N-77777"), "nitrox").verdict).toBe("namesake");
  });

  it("does not match a neighbour's record or a card listed after their name", () => {
    const neighbour = [
      "Lena Ortiz",
      "Card N-12345",
      "Open Water Diver",
      "Mark Lee",
      "Enriched Air Nitrox",
    ].join("\n");
    expect(check(neighbour, "nitrox").verdict).toBe("level_unconfirmed");
    const namesake = ["Lena Ortiz", "Card N-99999", "Open Water Diver", "Deep Diving"].join("\n");
    expect(check(namesake, "deep").verdict).toBe("namesake");
  });

  it("does not read a technical or professional rating as the card it contains", () => {
    for (const line of [
      "Deep Diving Instructor",
      "Tec Deep Diving",
      "Enriched Air Nitrox Instructor",
    ]) {
      const record = ["Lena Ortiz", "Card N-12345", "Open Water Diver", line].join("\n");
      const kind = line.includes("Nitrox") ? "nitrox" : "deep";
      expect(check(record, kind).verdict, line).not.toBe("match");
    }
  });

  it("does not match a limited or unfinished row, and says so", () => {
    expect(check(SSI.replace("Deep Diving", "Deep Diving (in progress)"), "deep").verdict).toBe(
      "limited_card",
    );
    expect(
      check(SSI.replace("Open Water Diver", "Junior Open Water Diver"), "nitrox").verdict,
    ).toBe("limited_card");
  });

  it("does not match for an agency whose table lists no such kind", () => {
    const gue = ["Lena Ortiz", "GUE-4411", "Recreational Diver 1", "Deep Diver"].join("\n");
    expect(check(gue, "deep", { agency: "gue", cardNumber: "GUE-4411" }).verdict).toBe(
      "level_unconfirmed",
    );
    // Its nitrox comes bundled in the level line, which is the card's page here.
    expect(check(gue, "nitrox", { agency: "gue", cardNumber: "GUE-4411" }).verdict).toBe("match");
  });

  it("passes the diver-level verdicts through, writing nothing", () => {
    expect(check("No results found", "nitrox").verdict).toBe("no_record");
    expect(check("Search the register", "nitrox").verdict).toBe("unreadable");
  });

  it("reads PADI's DiveChek rows, one per card, under the diver's number", () => {
    const rows = [
      "1 diver found",
      "Lena Ortiz 12 Apr 1990 PADI 778899 Open Water Diver 15 Jun 2015",
      "Lena Ortiz 12 Apr 1990 PADI 778899 Enriched Air Diver 2 Feb 2020",
    ].join("\n");
    const padi = { agency: "padi", cardNumber: "778899", birthDate: "1990-04-12" } as const;
    expect(check(rows, "nitrox", padi).verdict).toBe("match");
    expect(check(rows, "drysuit", padi).verdict).toBe("level_unconfirmed");
    expect(check(rows, "nitrox", { ...padi, cardNumber: "112233" }).verdict).toBe(
      "level_unconfirmed",
    );
  });
});
