import { describe, expect, it } from "vitest";
import {
  DECLARABLE_CERTIFICATION_LEVELS,
  diveDeclarationInput,
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
