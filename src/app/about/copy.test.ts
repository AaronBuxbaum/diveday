import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";

/**
 * **`/about` speaks as the company, and tells the Lonergan story within its
 * limits** (docs/product/marketing.md, "Biography is a claim like any other";
 * the 2026-10-07 rewrite is H-99 in docs/product/human-decisions.md).
 *
 * The page opens on why DiveDay exists: Tom and Eileen Lonergan, left behind
 * on the Great Barrier Reef in January 1998. Only what the public record holds
 * is stated, the operator and skipper are never named, and no sentence says or
 * implies DiveDay would have prevented it. Everything after that section
 * speaks for the company in generalities: no individual is named, no CV is
 * stated, and the heading over each band is a statement the band can be read
 * against rather than a question (the spoken register, H-89, left with the
 * 2026-10-07 rewrite).
 *
 * The tests below are the mechanical half of those rules. Each is arithmetic
 * over the bundle rather than taste, which is why the same assertions are safe
 * in Spanish without a second review: the register differs, the names and the
 * prevention claim do not. Every assertion runs against both locales, the way
 * the `/onboard` door's does: a page that keeps a rule in English and loses it
 * in Spanish is not this design.
 */
const LOCALES = Object.entries(DIVER_MESSAGES) as [
  DiverLocale,
  (typeof DIVER_MESSAGES)[DiverLocale],
][];

/** Every published sentence of the page, flattened, so a rule can read the whole of it. */
function sentencesOf(about: (typeof DIVER_MESSAGES)[DiverLocale]["marketing"]["about"]) {
  const values: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === "string") values.push(node);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(about);
  return values;
}

describe("the /about hero", () => {
  it.each(LOCALES)("tells the Lonergan story within the public record in %s", (_l, messages) => {
    const { heroDescription, heroP2 } = messages.marketing.about;
    expect(heroDescription).toContain("Lonergan");
    expect(heroDescription).toContain("1998");
    // The operator and the skipper are never named, in either language. The
    // account carries the facts and nothing a reader could take as blame.
    for (const value of [heroDescription, heroP2]) {
      expect(value).not.toMatch(/outer edge|skipper|patrón|operador|operator/i);
    }
  });

  it.each(LOCALES)("never claims DiveDay would have prevented it in %s", (_l, messages) => {
    // The tie from the story to the product is what the roll call *does*, not
    // what it would have done. A conditional perfect is the shape that claim
    // takes in both languages, so it is the shape refused.
    const { heroDescription, heroP2 } = messages.marketing.about;
    for (const value of [heroDescription, heroP2]) {
      expect(value).not.toMatch(
        /would have|could have|might have|habría|hubiera|hubiese|podría haber/i,
      );
    }
  });

  it.each(LOCALES)("ties the story to the product in the company's voice in %s", (_l, messages) => {
    // "That story is why we built DiveDay" (Aaron, 2026-10-07): the plural,
    // in both languages, and never the founder alone.
    const { heroP2 } = messages.marketing.about;
    expect(heroP2).toMatch(/we built DiveDay|construimos DiveDay/);
    expect(heroP2).not.toMatch(/\bI built\b|\bconstruí\b/);
  });
});

describe("the rest of /about", () => {
  it.each(LOCALES)("names no individual and states no CV in %s", (_l, messages) => {
    // The people who build DiveDay are described in generalities (Aaron,
    // 2026-10-07: "use generalities about people in a company"). The founder's
    // name, the employers that used to carry the page's credibility, and the
    // head count of the team are the facts that must not come back, in either
    // language. The Lonergans are the one pair of names the page carries, and
    // they live in the hero, which is tested above.
    const published = sentencesOf(messages.marketing.about).join(" ");
    expect(published).not.toMatch(
      /Aaron|Buxbaum|Google|biotech|self-driving|autos que se conducen/i,
    );
    expect(published).not.toMatch(/two of us|the other person|nosotros dos|la otra persona/i);
  });

  it.each(LOCALES)("speaks for the company, never for one person, in %s", (locale, messages) => {
    // No first-person singular anywhere on the page. The founder's own parts
    // were first-person singular until 2026-10-07; the page is the company's
    // now, and "we" is the only first person on it.
    const published = sentencesOf(messages.marketing.about).join(" ");
    const singular =
      locale === "es-ES"
        ? /\b(?:yo|soy|construí|trabajé|escribo|trabajo en|mi trabajo)\b/i
        : /\b(?:I|I’m|I’ve|my|me)\b/;
    expect(published).not.toMatch(singular);
  });

  it.each(LOCALES)("heads every band with a statement, not a question, in %s", (_l, messages) => {
    const { peopleTitle, buildTitle, workTitle, closingTitle } = messages.marketing.about;
    for (const title of [peopleTitle, buildTitle, workTitle, closingTitle]) {
      // A statement the band beneath it can be checked against: it ends like a
      // sentence, asks nothing, and fits on a phone without turning into a
      // paragraph.
      expect(title.trim()).toMatch(/\.$/);
      expect(title).not.toMatch(/[?¿]/);
      expect(title.split(/\s+/).length).toBeLessThanOrEqual(14);
    }
  });

  it.each(LOCALES)("promises no response time in %s", (_l, messages) => {
    // "Write in and a person reads it", never a turnaround (docs/product/
    // marketing.md, founder-direct support retired 2026-08-05, H-12/H-26).
    const { workP2, whoAnswersValue } = messages.marketing.about;
    for (const value of [workP2, whoAnswersValue]) {
      expect(value).not.toMatch(
        /within|same day|hours?|minutes?|en menos de|mismo día|horas?|minutos?/i,
      );
    }
  });

  it.each(LOCALES)("carries none of the retired spoken-register headings in %s", (_l, messages) => {
    // A ratchet, not a style note. From 2026-09-24 to 2026-10-07 every heading
    // on the page was the shop owner's question repeated back without a mark
    // (H-89); the owner retired the register with the copy ("I really really
    // don't like the copy on About"). Asserted by value so none of them comes
    // back under a new key.
    const retired = new Set([
      "Why did you build this",
      "Who am I dealing with",
      "How do I know any of that’s true",
      "Who answers when something breaks",
      "What’s the catch",
      "What happens to my records if I go",
      "How do I try it",
      "Por qué lo construiste",
      "Con quién estoy tratando",
      "Cómo sé que todo eso es cierto",
      "Quién responde cuando algo se rompe",
      "Cuál es la trampa",
      "Qué pasa con mis registros si me voy",
      "Cómo lo pruebo",
    ]);
    for (const value of sentencesOf(messages.marketing.about)) {
      expect(retired.has(value.trim()), `retired heading back on the page: ${value}`).toBe(false);
    }
  });
});
