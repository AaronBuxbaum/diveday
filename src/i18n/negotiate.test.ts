import { describe, expect, it } from "vitest";
import {
  firstHandLocale,
  matchLocale,
  negotiateLocale,
  parseAcceptLanguage,
  unsupportedLanguage,
} from "./negotiate";

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

// The third question about the same header, and the one that used to go
// unasked: a diver whose language DiveDay does not carry got the shop's
// language with no acknowledgement at all (review finding I18N-L1).
describe("unsupportedLanguage", () => {
  it("names the language a visitor asked for that DiveDay does not carry", () => {
    expect(unsupportedLanguage("de-CH,de;q=0.9")).toEqual({ tag: "de-CH", language: "de" });
    expect(unsupportedLanguage("fr-FR")).toEqual({ tag: "fr-FR", language: "fr" });
  });

  it("stays silent when the visitor asked for something we do carry", () => {
    // Including the case that matters most: they asked for German *and*
    // Spanish, and Spanish is what they get. Nothing went unmet, so there is
    // nothing honest to say.
    expect(unsupportedLanguage("es-MX,en;q=0.5")).toBeNull();
    expect(unsupportedLanguage("de;q=0.4,es-AR;q=0.9")).toBeNull();
    expect(unsupportedLanguage("de;q=0.9,en;q=0.4")).toBeNull();
    expect(unsupportedLanguage("en-GB")).toBeNull();
  });

  it("stays silent when the visitor expressed no preference", () => {
    // A client that sends no header, or only `*`, has told us nothing about
    // itself — announcing a fallback there would be inventing a reader.
    expect(unsupportedLanguage(null)).toBeNull();
    expect(unsupportedLanguage("")).toBeNull();
    expect(unsupportedLanguage("*")).toBeNull();
    expect(unsupportedLanguage("*;q=0.5")).toBeNull();
  });

  it("takes the highest-quality unmet language, not the first one written", () => {
    expect(unsupportedLanguage("fr;q=0.2,ja;q=0.9")).toEqual({ tag: "ja", language: "ja" });
  });

  it("only ever returns a structurally valid language subtag", () => {
    // This is the guard that keeps an attacker-controllable header out of
    // `Intl.DisplayNames`, which throws a RangeError on a malformed code.
    for (const header of [
      "🙂",
      ";;;",
      "-",
      "123",
      "toolongsubtag",
      "e",
      "en_US",
      "de-DE;q=notanumber",
    ]) {
      const result = unsupportedLanguage(header);
      expect(result === null || /^[a-z]{2,3}$/.test(result.language)).toBe(true);
    }
    // Junk in the front position must not mask a real preference behind it.
    expect(unsupportedLanguage("🙂,de;q=0.8")).toEqual({ tag: "de", language: "de" });
  });
});
