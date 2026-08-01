import { describe, expect, it } from "vitest";
import { firstHandLocale, matchLocale, negotiateLocale, parseAcceptLanguage } from "./negotiate";

describe("parseAcceptLanguage", () => {
  it("orders by quality, best first", () => {
    expect(parseAcceptLanguage("en;q=0.5,es;q=0.9,fr;q=0.1").map((p) => p.tag)).toEqual([
      "es",
      "en",
      "fr",
    ]);
  });

  it("treats a missing q as the highest preference", () => {
    expect(parseAcceptLanguage("es-MX,en;q=0.8")[0]).toEqual({ tag: "es-MX", quality: 1 });
  });

  it("drops entries the sender explicitly refused (q=0)", () => {
    expect(parseAcceptLanguage("es;q=0,en").map((p) => p.tag)).toEqual(["en"]);
  });

  it("survives junk without throwing — this header is attacker-controllable", () => {
    for (const header of ["", ";;;", "en;q=notanumber", ",,,", "🙂"]) {
      expect(() => parseAcceptLanguage(header)).not.toThrow();
    }
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage("en;q=notanumber")).toEqual([]);
  });
});

describe("matchLocale", () => {
  it("takes an exact tag", () => {
    expect(matchLocale(parseAcceptLanguage("es-ES"))).toBe("es-ES");
  });

  it("matches on the primary subtag, so a Mexican diver gets Spanish", () => {
    expect(matchLocale(parseAcceptLanguage("es-MX,en;q=0.5"))).toBe("es-ES");
    expect(matchLocale(parseAcceptLanguage("es-419"))).toBe("es-ES");
    expect(matchLocale(parseAcceptLanguage("es"))).toBe("es-ES");
  });

  it("respects quality order across regions", () => {
    expect(matchLocale(parseAcceptLanguage("en-GB;q=0.4,es-AR;q=0.9"))).toBe("es-ES");
  });

  it("returns nothing for a language DiveDay does not carry", () => {
    expect(matchLocale(parseAcceptLanguage("fr-FR,de;q=0.8"))).toBeNull();
  });

  it("ignores the wildcard — 'anything' is not a preference", () => {
    expect(matchLocale(parseAcceptLanguage("*"))).toBeNull();
  });
});

describe("negotiateLocale", () => {
  it("renders what the visitor's device asked for when we carry it", () => {
    expect(negotiateLocale("es-MX,en;q=0.5", "en-US")).toBe("es-ES");
    expect(negotiateLocale("en-GB", "es-ES")).toBe("en-US");
  });

  it("falls back to the shop's own default when the visitor asked for neither", () => {
    expect(negotiateLocale("fr-FR", "es-ES")).toBe("es-ES");
    expect(negotiateLocale(null, "es-ES")).toBe("es-ES");
  });

  it("falls back again to English when the shop's stored value is unusable", () => {
    expect(negotiateLocale(null, "kl-GL")).toBe("en-US");
    expect(negotiateLocale(null, null)).toBe("en-US");
  });
});

// What separates "they asked for this" from "we defaulted to this" — the
// distinction the per-person locale column is only allowed to record the first
// half of (docs ADR 20260731-per-person-notification-locale).
describe("firstHandLocale", () => {
  it("answers with what the device actually asked for", () => {
    expect(firstHandLocale("es-MX,en;q=0.5")).toBe("es-ES");
    expect(firstHandLocale("en-GB")).toBe("en-US");
  });

  it("answers null where negotiateLocale would answer with the shop's default", () => {
    // Same inputs, two different jobs: the page still renders in Spanish, but
    // nothing about this visitor has been learned, so nothing may be stored.
    expect(negotiateLocale("fr-FR", "es-ES")).toBe("es-ES");
    expect(firstHandLocale("fr-FR")).toBeNull();

    expect(negotiateLocale(null, "es-ES")).toBe("es-ES");
    expect(firstHandLocale(null)).toBeNull();
  });

  it("never lets an unsupported or malformed header through", () => {
    for (const header of ["", ";;;", "*", "de-DE", "en;q=notanumber", "🙂", "es-ES; DROP TABLE"]) {
      const result = firstHandLocale(header);
      expect(result === null || result === "en-US" || result === "es-ES").toBe(true);
    }
    expect(firstHandLocale("de-DE,fr;q=0.8")).toBeNull();
    expect(firstHandLocale("🙂")).toBeNull();
  });
});
