import { describe, expect, it } from "vitest";
import {
  boundedText,
  fillFacts,
  hasNumberWord,
  numbersCameFrom,
  sameNumberWords,
  samePlaceholders,
} from "./facts";

describe("fillFacts", () => {
  it("fills each placeholder from the record", () => {
    expect(
      fillFacts("A wall to {maxDepth}, for {minCert}.", { maxDepth: "30 m", minCert: "Advanced" }),
    ).toBe("A wall to 30 m, for Advanced.");
  });

  it("refuses a digit the model wrote itself", () => {
    expect(fillFacts("A wall to 40 m.", { maxDepth: "30 m" })).toBeNull();
    expect(fillFacts("Depth {maxDepth}, 2 tanks.", { maxDepth: "30 m" })).toBeNull();
  });

  it("refuses a placeholder the caller did not offer", () => {
    expect(fillFacts("Costs {price}.", { maxDepth: "30 m" })).toBeNull();
    expect(fillFacts("{constructor}", {})).toBeNull();
  });
});

describe("numbersCameFrom", () => {
  it("allows dropping a number and refuses adding or changing one", () => {
    expect(numbersCameFrom("Serviced at 300 bar.", "Tested 300 bar, 2 o-rings")).toBe(true);
    expect(numbersCameFrom("Serviced at 200 bar.", "Tested 300 bar")).toBe(false);
    expect(numbersCameFrom("3 and 3", "3")).toBe(false);
  });

  describe("matches each number by kind, as a whole token", () => {
    const facts = "- Sat, Oct 24 8:00 AM, Reef: 2 seats open, $85.00\nPhone: +1 305-555-0100";

    it("never lets a count borrow from a time, a date, a price or a phone", () => {
      expect(numbersCameFrom("There are 8 seats open.", facts)).toBe(false);
      expect(numbersCameFrom("We have 24 seats.", facts)).toBe(false);
      expect(numbersCameFrom("We have 85 seats.", facts)).toBe(false);
      expect(numbersCameFrom("We have 305 seats.", facts)).toBe(false);
      expect(numbersCameFrom("There are 2 seats open.", facts)).toBe(true);
    });

    it("never lets a time borrow from another time's minutes, a count or a price", () => {
      expect(numbersCameFrom("It leaves at 8:30.", "- 8:00 AM, Reef\n- 1:30 PM, Wreck")).toBe(
        false,
      );
      expect(numbersCameFrom("It leaves at 2 PM.", facts)).toBe(false);
      expect(numbersCameFrom("It leaves at 8:00.", facts)).toBe(true);
      expect(numbersCameFrom("It leaves at 8:00 AM.", facts)).toBe(true);
      expect(numbersCameFrom("It leaves at 8 AM.", facts)).toBe(true);
      expect(numbersCameFrom("It leaves at 8:00 PM.", facts)).toBe(false);
      expect(numbersCameFrom("It leaves at 13:30.", "- 1:30 PM, Wreck")).toBe(true);
    });

    it("matches a date as a whole date, in either order or language", () => {
      expect(numbersCameFrom("See you on Oct 24.", facts)).toBe(true);
      expect(numbersCameFrom("See you on 24 October.", facts)).toBe(true);
      expect(numbersCameFrom("Nos vemos el 24 de octubre.", facts)).toBe(true);
      expect(numbersCameFrom("See you on the 24th.", facts)).toBe(true);
      expect(numbersCameFrom("See you on Oct 25.", facts)).toBe(false);
      expect(numbersCameFrom("See you on Nov 24.", facts)).toBe(false);
      expect(numbersCameFrom("See you on the 8th.", facts)).toBe(false);
    });

    it("matches a price by its amount, never by a part of it", () => {
      expect(numbersCameFrom("It is $85.", facts)).toBe(true);
      expect(numbersCameFrom("Son 85,00 US$.", facts)).toBe(true);
      expect(numbersCameFrom("It is $8.50.", facts)).toBe(false);
      expect(numbersCameFrom("It is $2.", facts)).toBe(false);
      expect(numbersCameFrom("It is $24.", facts)).toBe(false);
    });

    it("reads a count beside a price as a count, and a figure date the same both ways", () => {
      expect(numbersCameFrom("2 $95 seats", "2 seats at $95")).toBe(true);
      expect(numbersCameFrom("A 1/2 inch hose.", "Replaced the 1/2 inch hose.")).toBe(true);
      expect(numbersCameFrom("See you 10/24.", facts)).toBe(true);
      expect(numbersCameFrom("See you 10/25.", facts)).toBe(false);
    });

    it("lets an hour written as 9 h stand for 9 am or for nine hours, nothing else", () => {
      expect(numbersCameFrom("9 h, 4 horas", "9 am, 4 hours")).toBe(true);
      expect(numbersCameFrom("10 h", "9 am")).toBe(false);
    });

    it("matches a phone number only whole", () => {
      expect(numbersCameFrom("Call +1 305-555-0100.", facts)).toBe(true);
      expect(numbersCameFrom("Call 305-555-0199.", facts)).toBe(false);
    });
  });
});

describe("sameNumberWords", () => {
  it("compares count words by value across English and Spanish", () => {
    expect(sameNumberWords("We have two seats left.", "Nos quedan dos plazas.")).toBe(true);
    expect(sameNumberWords("We have two seats left.", "Nos quedan tres plazas.")).toBe(false);
    expect(sameNumberWords("A couple of seats.", "Un par de plazas.")).toBe(true);
    expect(sameNumberWords("Seats left.", "Nos quedan tres plazas.")).toBe(false);
    expect(sameNumberWords("Two seats, three tanks.", "Dos plazas.")).toBe(false);
  });

  it("leaves one out, since Spanish writes it as an article", () => {
    expect(sameNumberWords("One more seat.", "Una plaza más.")).toBe(true);
  });
});

describe("hasNumberWord", () => {
  it("finds a count in words, in either language", () => {
    expect(hasNumberWord("Three seats left.")).toBe(true);
    expect(hasNumberWord("Quedan tres lugares.")).toBe(true);
    expect(hasNumberWord("Seats are open.")).toBe(false);
  });

  it("lets a word the given text says through, as often as it says it", () => {
    const given = "Sat 8:00 AM, Two-tank reef: 4 seats open";
    expect(hasNumberWord("The Two-tank reef has 4 seats.", given)).toBe(false);
    expect(hasNumberWord("Two-tank reef, two seats.", given)).toBe(true);
    expect(hasNumberWord("Two-tank reef has three seats.", given)).toBe(true);
  });
});

describe("samePlaceholders", () => {
  it("compares markers as a multiset", () => {
    expect(samePlaceholders("To {depth18} and {depth18}", "Hasta {depth18} y {depth18}")).toBe(
      true,
    );
    expect(samePlaceholders("To {depth18}", "Hasta {depth30}")).toBe(false);
  });
});

describe("boundedText", () => {
  it("drops blank and over-long text", () => {
    expect(boundedText("  hi ", 5)).toBe("hi");
    expect(boundedText("   ", 5)).toBeNull();
    expect(boundedText("toolong", 3)).toBeNull();
  });
});
