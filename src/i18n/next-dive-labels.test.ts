import { describe, expect, it } from "vitest";
import { NEXT_DIVE_REASONS } from "@/lib/next-dive";
import { diverTranslator } from "./messages";
import {
  DIVER_CERT_LEVEL_KEYS,
  NEXT_DIVE_REASON_KEYS,
  RECAP_PULSE_CATEGORY_KEYS,
  STAFF_PULSE_CATEGORY_KEYS,
} from "./next-dive-labels";
import { staffTranslator } from "./staff-messages";

/**
 * The four maps in this module are the whole distance between a code the
 * domain layer returns and a sentence a diver reads on a boat, and nothing
 * stood beside them: `pnpm check:locale` proves both bundles carry the same
 * keys, and the `Record<Code, …>` types prove every code is mapped, but
 * neither proves the key a code is mapped *to* resolves to anything. A key
 * that exists in both bundles under the wrong name resolves through
 * `getMessageFallback` to the dotted key itself, which is what a diver would
 * then read.
 *
 * The Spanish half needs its own assertion for the same reason: a missing
 * es-ES key falls back to the **English** string rather than throwing, so
 * "not empty" is satisfied by a bundle with no translation in it at all.
 */

const en = diverTranslator("en-US");
const es = diverTranslator("es-ES");

/** Every fact any reason sentence can name, so one call covers all five. */
const FACTS = { site: "Blue Hole", course: "Advanced Open Water", lens: "drift" };

describe("NEXT_DIVE_REASON_KEYS", () => {
  it("words every rung of the precedence, in both locales", () => {
    for (const reason of NEXT_DIVE_REASONS) {
      const key = NEXT_DIVE_REASON_KEYS[reason];
      for (const t of [en, es]) {
        const sentence = t(key, FACTS);
        expect(sentence.trim()).not.toBe("");
        // The fallback for a key neither bundle holds is the dotted key.
        expect(sentence).not.toBe(key);
        // A placeholder the caller did not fill would survive to the screen.
        expect(sentence).not.toMatch(/[{}]/);
      }
    }
  });

  it("names the fact the reason claims, rather than restating the code", () => {
    expect(en(NEXT_DIVE_REASON_KEYS.crew_named_site, FACTS)).toContain("Blue Hole");
    expect(en(NEXT_DIVE_REASON_KEYS.course_next_session, FACTS)).toContain("Advanced Open Water");
    expect(en(NEXT_DIVE_REASON_KEYS.same_lens, FACTS)).toContain("drift");
    expect(en(NEXT_DIVE_REASON_KEYS.same_site, FACTS)).toContain("Blue Hole");
    // The floor names no fact — it is "it is next and it has a seat" — so it
    // must not leave a hole where one would have gone.
    expect(en(NEXT_DIVE_REASON_KEYS.soonest_with_room, FACTS)).not.toContain("Blue Hole");
  });

  it("speaks Spanish rather than falling back to the English", () => {
    for (const reason of NEXT_DIVE_REASONS) {
      const key = NEXT_DIVE_REASON_KEYS[reason];
      expect(es(key, FACTS)).not.toBe(en(key, FACTS));
    }
  });

  it("gives each reason its own sentence", () => {
    // Two rungs sharing a key would make the card's reason unfalsifiable: the
    // diver reads the same line whichever rule fired.
    const keys = NEXT_DIVE_REASONS.map((reason) => NEXT_DIVE_REASON_KEYS[reason]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("DIVER_CERT_LEVEL_KEYS", () => {
  it("names every rung of the ladder in the diver's own bundle", () => {
    for (const [level, key] of Object.entries(DIVER_CERT_LEVEL_KEYS)) {
      for (const t of [en, es]) {
        const label = t(key);
        expect(label.trim()).not.toBe("");
        expect(label).not.toBe(key);
        // "open_water" reaching a card would be the code, not a word.
        expect(label).not.toBe(level);
      }
    }
  });

  it("keeps the diver's words out of the staff bundle's reach", () => {
    // The staff ladder is a deliberate second copy (readiness-labels.ts); the
    // guard here is only that these keys resolve in the *diver* bundle.
    expect(en(DIVER_CERT_LEVEL_KEYS.rescue)).toBe("Rescue Diver");
    expect(es(DIVER_CERT_LEVEL_KEYS.rescue)).toBe("Buceador de Rescate");
  });
});

describe("the pulse chips", () => {
  const enStaff = staffTranslator("en-US");
  const esStaff = staffTranslator("es-ES");

  it("offers every category to the diver, in both locales", () => {
    for (const [category, key] of Object.entries(RECAP_PULSE_CATEGORY_KEYS)) {
      for (const t of [en, es]) {
        const label = t(key);
        expect(label.trim()).not.toBe("");
        expect(label).not.toBe(key);
        expect(label).not.toBe(category);
      }
    }
  });

  it("reads back to the shop in the staff bundle, one word each", () => {
    for (const [category, key] of Object.entries(STAFF_PULSE_CATEGORY_KEYS)) {
      for (const t of [enStaff, esStaff]) {
        const label = t(key);
        expect(label.trim()).not.toBe("");
        expect(label).not.toBe(key);
        expect(label).not.toBe(category);
      }
    }
  });

  it("covers the same categories on both sides of the review", () => {
    // A chip a diver can pick and a shop cannot read back is a rating that
    // disappears on the staff panel.
    expect(Object.keys(STAFF_PULSE_CATEGORY_KEYS).sort()).toEqual(
      Object.keys(RECAP_PULSE_CATEGORY_KEYS).sort(),
    );
  });
});
