import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES, diverTranslator, messagesFor } from "./messages";
import {
  DEFAULT_DIVER_LOCALE,
  DIVER_LOCALE_LABELS,
  DIVER_LOCALES,
  isDiverLocale,
  toDiverLocale,
} from "./settings";

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

  it("labels every locale for the settings picker", () => {
    for (const locale of DIVER_LOCALES) expect(DIVER_LOCALE_LABELS[locale]).toBeTruthy();
  });
});

describe("diverTranslator", () => {
  it("renders in the shop's language", () => {
    expect(diverTranslator("en-US")("schedule.title")).toBe("Schedule");
    expect(diverTranslator("es-ES")("schedule.title")).toBe("Calendario");
    expect(diverTranslator("es-ES")("booking.heading")).toBe("Reserva tu plaza");
  });

  it("interpolates ICU arguments", () => {
    expect(diverTranslator("en-US")("booking.fullBody", { capacity: 12 })).toBe(
      "All 12 spots are taken.",
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

  it("falls back to English for a language DiveDay does not carry yet", () => {
    // Blanks (or a raw key) would be worse than English: a shop whose row names
    // an unsupported locale still gets a usable booking page.
    expect(diverTranslator("fr-FR")("schedule.title")).toBe("Schedule");
    expect(diverTranslator(null)("booking.heading")).toBe("Grab a spot");
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
