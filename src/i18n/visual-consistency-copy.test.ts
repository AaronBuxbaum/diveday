import { describe, expect, it } from "vitest";
import type { BoatWorkCode } from "@/lib/boat-work";
import { boatWorkSentence, boatWorkText } from "./boat-work-labels";
import en from "./locales/en-US/diver.json";
import es from "./locales/es-ES/diver.json";
import { staffTranslator } from "./staff-messages";

const sentenceErrors = [
  "invalidInput",
  "shopNameRequired",
  "shopSlugRequired",
  "shopSlugInvalid",
  "timezoneRequired",
  "ownerNameRequired",
  "ownerPasswordTooShort",
  "ownerPasswordTooLong",
] as const;

describe("the punctuation belongs to the copy's role", () => {
  it.each([en, es])("punctuates complete inline validation sentences", (bundle) => {
    for (const key of ["tooShort", "tooLong", "mismatch"] as const) {
      expect(bundle.account.common.passwordErrors[key]).toMatch(/\.$/);
    }
    for (const key of sentenceErrors) expect(bundle.account.onboard.errors[key]).toMatch(/\.$/);
  });

  it("keeps the English timezone fragment and punctuates the Spanish sentence", () => {
    expect(en.account.onboard.errors.timezoneInvalid).toBe("Not a recognized timezone");
    expect(es.account.onboard.errors.timezoneInvalid).toMatch(/\.$/);
  });

  it.each([en, es])("uses heading punctuation for thread status leads", (bundle) => {
    for (const value of Object.values(bundle.thread.next)) expect(value).not.toMatch(/\.$/);
    expect(bundle.thread.withShopHead).not.toMatch(/\.$/);
    expect(bundle.thread.next.gear).toMatch(/\?$/);
    expect(bundle.thread.withShopHead).toContain(". ");
  });

  it.each(["en-US", "es-ES"])(
    "keeps boat-work fragments bare and full statements punctuated in %s",
    (locale) => {
      const t = staffTranslator(locale);
      for (const count of [1, 3]) {
        for (const code of [
          "missing_sizes",
          "open_orders",
          "missing_contact",
          "ungated_nitrox",
        ] as BoatWorkCode[]) {
          const item = { code, count, tone: "work" as const };
          const text = boatWorkSentence(t, item);
          expect(text).toBe(boatWorkText(t, item));
          if (code === "missing_contact" || code === "ungated_nitrox") expect(text).toMatch(/\.$/);
          else expect(text).not.toMatch(/\.$/);
        }
        const sizes = {
          code: "missing_sizes" as const,
          count: count + 3,
          tone: "work" as const,
          sizes: { missing: count, unasked: 3 },
        };
        expect(boatWorkSentence(t, sizes)).toBe(boatWorkText(t, sizes));
        expect(boatWorkSentence(t, sizes)).not.toMatch(/\.$/);
      }
    },
  );
});
