import { describe, expect, it } from "vitest";
import {
  DECLARABLE_CERTIFICATION_LEVELS,
  diveDeclarationInput,
  diveDeclarationInputAt,
  diveDeclarationSchema,
  NO_CERTIFICATION_ANSWER,
  toDiveDeclaration,
} from "./dive-declaration";

/**
 * **What an anonymous joiner is allowed to say about their own diving.**
 *
 * Both public "tell me when something comes up" forms post here, so this is the
 * one answer to "what can a stranger write" — and the one place the select's
 * two *kinds* of answer are told apart: a rung on the ladder, or a statement
 * that there is no card at all (ADR 20260814-self-declared-cards).
 */
function parse(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  const parsed = diveDeclarationSchema.safeParse(diveDeclarationInput(formData));
  if (!parsed.success) return null;
  return toDiveDeclaration(parsed.data);
}

describe("diveDeclarationSchema", () => {
  it("accepts each rung of the ladder", () => {
    for (const level of DECLARABLE_CERTIFICATION_LEVELS) {
      expect(parse({ certificationLevel: level })).toEqual({
        level,
        noCertification: false,
        nitrox: false,
      });
    }
  });

  it("reads an untouched select as silence rather than refusing the sign-up", () => {
    // An untouched `<select>` posts `""`, and zod's enum would refuse that and
    // take the whole join down with it.
    expect(parse({ certificationLevel: "" })).toEqual({
      level: undefined,
      noCertification: false,
      nitrox: false,
    });
  });

  it("refuses a level that is not on the ladder", () => {
    expect(parse({ certificationLevel: "technical_god" })).toBeNull();
  });

  /**
   * The answer that is not a rung. It must never arrive as a `level`: that type
   * is an ordering `certificationRank` sorts and `trip-admission.ts` asserts
   * against, and a rank-0 member would eventually be compared as a level —
   * admitting a non-diver to a departure that asks for nothing in particular.
   */
  it("splits 'I'm not certified yet' out of the level entirely", () => {
    expect(parse({ certificationLevel: NO_CERTIFICATION_ANSWER })).toEqual({
      level: undefined,
      noCertification: true,
      nitrox: false,
    });
  });

  it("keeps the answer distinguishable from a skipped question", () => {
    const skipped = parse({});
    const stated = parse({ certificationLevel: NO_CERTIFICATION_ANSWER });
    // The whole point of the value: silence and "I hold no card" are two
    // different things, and reading them as one is what mailed a Discover
    // Scuba customer a certified two-tank charter.
    expect(skipped?.noCertification).toBe(false);
    expect(stated?.noCertification).toBe(true);
  });

  it("takes the nitrox tick only as the literal the checkbox posts", () => {
    expect(parse({ nitroxCertified: "on" })?.nitrox).toBe(true);
    // An arbitrary posted string is a refusal to parse, never a truthy tick
    // nobody made.
    expect(parse({ nitroxCertified: "yes" })).toBeNull();
    // Unticked is silence, and silence can never contradict a card on file.
    expect(parse({})?.nitrox).toBe(false);
  });
});

/**
 * **The card beside the rung** (issue #630, from #609).
 *
 * Two optional fields that give the verify queue something to work with before
 * the dive date, where until now it had a level and nothing else. Neither gates
 * anything, and the properties below are all about that: a bad one is silence,
 * not a refusal, and neither survives without a real level to belong to.
 */
describe("the declared card's agency and number", () => {
  it("carries both when a diver gives them beside a real level", () => {
    expect(
      parse({
        certificationLevel: "rescue",
        certificationAgency: "padi",
        certificationNumber: "PA-118824",
      }),
    ).toEqual({
      level: "rescue",
      noCertification: false,
      agency: "padi",
      identifier: "PA-118824",
      nitrox: false,
    });
  });

  it("still believes a diver who knows their rung but not their number", () => {
    // The decision the whole field rests on: refusing this submission would
    // trade a booking for a form field.
    expect(parse({ certificationLevel: "open_water" })).toEqual({
      level: "open_water",
      noCertification: false,
      agency: undefined,
      identifier: undefined,
      nitrox: false,
    });
  });

  it("drops a number that is not one, rather than refusing the booking", () => {
    // `isPlausibleCardNumber` is a typo filter, and this box is optional on a
    // form whose point is the sale. "n/a" says nothing and lands as nothing;
    // the level still stands.
    const parsed = parse({ certificationLevel: "rescue", certificationNumber: "n/a" });
    expect(parsed?.level).toBe("rescue");
    expect(parsed?.identifier).toBeUndefined();
  });

  it("drops an agency that is not one, for the same reason", () => {
    const parsed = parse({ certificationLevel: "rescue", certificationAgency: "not-an-agency" });
    expect(parsed?.level).toBe("rescue");
    expect(parsed?.agency).toBeUndefined();
  });

  it("refuses to describe a card the same submission says does not exist", () => {
    // The form reveals these two boxes only once a rung is picked, but a
    // hand-crafted post can send them anyway. An agency and a number beside
    // "I'm not certified yet" is a contradiction, and it is resolved here so
    // that nothing downstream ever has to.
    expect(
      parse({
        certificationLevel: NO_CERTIFICATION_ANSWER,
        certificationAgency: "padi",
        certificationNumber: "PA-1",
      }),
    ).toEqual({
      level: undefined,
      noCertification: true,
      agency: undefined,
      identifier: undefined,
      nitrox: false,
    });
    // And beside no answer at all, which is the same thing said more quietly.
    const unsaid = parse({ certificationAgency: "padi", certificationNumber: "PA-1" });
    expect(unsaid?.agency).toBeUndefined();
    expect(unsaid?.identifier).toBeUndefined();
  });
});

/**
 * The booking form asks the whole question once per diver in the party, and the
 * card fields have to travel with the rung they belong to — a party of four is
 * four different cards, and one diver's number landing on another's record is
 * the failure this indexing exists to prevent.
 */
describe("diveDeclarationInputAt", () => {
  it("reads each diver's own card fields, never the lead's", () => {
    const formData = new FormData();
    formData.set("certificationLevel-0", "open_water");
    formData.set("certificationAgency-0", "padi");
    formData.set("certificationNumber-0", "OW-1");
    formData.set("certificationLevel-1", "rescue");
    formData.set("certificationAgency-1", "ssi");
    formData.set("certificationNumber-1", "RS-2");

    const read = (index: number) => {
      const parsed = diveDeclarationSchema.safeParse(diveDeclarationInputAt(formData, index));
      return parsed.success ? toDiveDeclaration(parsed.data) : null;
    };
    expect(read(0)).toMatchObject({ level: "open_water", agency: "padi", identifier: "OW-1" });
    expect(read(1)).toMatchObject({ level: "rescue", agency: "ssi", identifier: "RS-2" });
    // A slot nobody filled in is silence at every field, not the lead's answer.
    expect(read(2)).toEqual({
      level: undefined,
      noCertification: false,
      agency: undefined,
      identifier: undefined,
      nitrox: false,
    });
  });
});
