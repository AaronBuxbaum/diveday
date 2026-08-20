import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES, diverTranslator, messagesFor, messagesForNamespaces } from "./messages";
import { DEFAULT_DIVER_LOCALE, DIVER_LOCALES, isDiverLocale, toDiverLocale } from "./settings";

/** Every leaf as `dotted.path` → message. */
function flatten(node: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      Object.assign(out, flatten(value as Record<string, unknown>, dotted));
    } else {
      out[dotted] = String(value);
    }
  }
  return out;
}

describe("message bundles", () => {
  const reference = flatten(DIVER_MESSAGES[DEFAULT_DIVER_LOCALE]);

  it("covers the diver surface rather than being a stub", () => {
    expect(Object.keys(reference).length).toBeGreaterThan(50);
  });

  it("carries every key in every locale a shop can pick", () => {
    const missing = DIVER_LOCALES.flatMap((locale) => {
      const bundle = flatten(DIVER_MESSAGES[locale]);
      return Object.keys(reference)
        .filter((key) => !bundle[key]?.trim())
        .map((key) => `${locale} is missing ${key}`);
    });
    expect(missing).toEqual([]);
  });

  it("has no locale bundle carrying keys the default does not", () => {
    const stray = DIVER_LOCALES.flatMap((locale) =>
      Object.keys(flatten(DIVER_MESSAGES[locale]))
        .filter((key) => !(key in reference))
        .map((key) => `${locale} has stray ${key}`),
    );
    expect(stray).toEqual([]);
  });
});

describe("diverTranslator", () => {
  it("renders in the shop's language", () => {
    expect(diverTranslator("en-US")("schedule.title")).toBe("Schedule");
    expect(diverTranslator("es-ES")("schedule.title")).toBe("Calendario");
    expect(diverTranslator("es-ES")("booking.heading")).toBe("Reserva tu plaza");
  });

  it("interpolates ICU arguments", () => {
    expect(diverTranslator("en-US")("booking.waitlistConfirmedHeading", { name: "Marta" })).toBe(
      "You’re on the wait list, Marta.",
    );
    expect(diverTranslator("es-ES")("booking.waitlistConfirmedHeading", { name: "Marta" })).toBe(
      "Estás en la lista de espera, Marta.",
    );
  });

  it("picks the right plural form per language, rather than gluing on an 's'", () => {
    const en = diverTranslator("en-US");
    expect(en("reviews.aggregate", { average: "4.5", count: 1 })).toBe("4.5 out of 5 · 1 review");
    expect(en("reviews.aggregate", { average: "4.5", count: 2 })).toBe("4.5 out of 5 · 2 reviews");

    const es = diverTranslator("es-ES");
    expect(es("reviews.aggregate", { average: "4,5", count: 1 })).toBe("4,5 sobre 5 · 1 opinión");
    expect(es("reviews.aggregate", { average: "4,5", count: 3 })).toBe("4,5 sobre 5 · 3 opiniones");
  });

  it("passes WhatsApp's own {{1}} placeholders through instead of eating them", () => {
    // Meta's template syntax is positional double braces, which ICU reads as a
    // malformed argument — so the message is quoted (`'{{1}}'`) in the bundle.
    // Without the quotes the translator raises INVALID_MESSAGE, swallows it,
    // and hands back the *English* fallback: a Spanish shop's template would
    // register in English while `templateLanguage` claimed otherwise. The
    // apostrophes are load-bearing; this is what says so.
    expect(diverTranslator("en-US")("notifications.whatsappTemplate.body")).toBe(
      "Hi! An update from {{1}}: {{2}}",
    );
    expect(diverTranslator("es-ES")("notifications.whatsappTemplate.body")).toBe(
      "¡Hola! Un aviso de {{1}}: {{2}}",
    );
  });

  it("falls back to English for a language DiveDay does not carry yet", () => {
    // Blanks (or a raw key) would be worse than English: a shop whose row names
    // an unsupported locale still gets a usable booking page.
    expect(diverTranslator("fr-FR")("schedule.title")).toBe("Schedule");
    expect(diverTranslator(null)("booking.heading")).toBe("Grab a spot");
  });
});

describe("messagesForNamespaces", () => {
  it("returns only the requested top-level namespaces", () => {
    const picked = messagesForNamespaces("en-US", ["rental", "common"]);
    expect(Object.keys(picked).sort()).toEqual(["common", "rental"]);
    expect(picked.rental).toEqual(DIVER_MESSAGES["en-US"].rental);
    expect(picked.common).toEqual(DIVER_MESSAGES["en-US"].common);
  });

  it("carries the same content as the full bundle for each picked namespace, in any locale", () => {
    const picked = messagesForNamespaces("es-ES", ["booking"]);
    expect(picked).toEqual({ booking: DIVER_MESSAGES["es-ES"].booking });
  });

  it("is dramatically smaller than the full bundle it's picked from", () => {
    const full = JSON.stringify(messagesFor("en-US"));
    const picked = JSON.stringify(messagesForNamespaces("en-US", ["lastMinute", "common"]));
    expect(picked.length).toBeLessThan(full.length / 4);
  });

  it("returns an empty object for an empty namespace list, rather than the whole bundle", () => {
    expect(messagesForNamespaces("en-US", [])).toEqual({});
  });

  it("falls back to the default locale's bundle for an unsupported locale, same as messagesFor", () => {
    expect(messagesForNamespaces("fr-FR", ["common"])).toEqual({
      common: DIVER_MESSAGES[DEFAULT_DIVER_LOCALE].common,
    });
  });
});

describe("locale narrowing", () => {
  it("accepts supported locales and rejects anything else", () => {
    expect(isDiverLocale("es-ES")).toBe(true);
    // This value reaches Intl formatters and a lang attribute, so free text
    // must never pass.
    expect(isDiverLocale("fr-FR")).toBe(false);
    expect(isDiverLocale("../../etc")).toBe(false);
    expect(isDiverLocale(null)).toBe(false);
  });

  it("narrows a stored value to a bundle that exists", () => {
    expect(toDiverLocale("es-ES")).toBe("es-ES");
    expect(toDiverLocale("fr-FR")).toBe(DEFAULT_DIVER_LOCALE);
    expect(toDiverLocale(null)).toBe(DEFAULT_DIVER_LOCALE);
    expect(messagesFor("fr-FR")).toBe(DIVER_MESSAGES[DEFAULT_DIVER_LOCALE]);
  });
});
