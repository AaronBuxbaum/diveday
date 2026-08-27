import { describe, expect, it } from "vitest";
import {
  DECLARABLE_CERTIFICATION_LEVELS,
  type DiveDeclaration,
  declarationWithinPersonBudget,
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
 * **The per-subject budget on a public declaration.**
 *
 * Both surviving public forms are anonymous and bounded per IP only, and a
 * rotating set of addresses is exactly what a per-IP bucket cannot see. These
 * pin the two properties that make `declarationWithinPersonBudget` worth
 * having at all — that the key is the address the claim is *about*, and that
 * an empty bucket costs the claim rather than the sign-up.
 *
 * Real buckets, not a mock: `checkRateLimit`'s in-process store is the one
 * unit tests get, and asserting through it is what proves the key actually
 * varies with what these tests say it varies with. Addresses are unique per
 * test because that store outlives each one.
 */
describe("declarationWithinPersonBudget", () => {
  const claim: DiveDeclaration = {
    level: "open_water",
    noCertification: false,
    agency: "padi",
    identifier: "PA-1",
    nitrox: false,
  };
  const SHOP = "shop-a";
  const drain = async (email: string, shopId = SHOP) => {
    const results: Array<DiveDeclaration | undefined> = [];
    for (let i = 0; i < 6; i += 1) {
      results.push(await declarationWithinPersonBudget(claim, { shopId, email }));
    }
    return results;
  };

  it("stops writing to one address after five, and says so by returning nothing", async () => {
    const results = await drain("spray-target@example.invalid");
    expect(results.slice(0, 5)).toEqual([claim, claim, claim, claim, claim]);
    // Not a throw and not a refusal — the caller passes this straight into the
    // `declaration:` field it was already filling, so the join goes through
    // with nothing said. That is the same outcome a malformed claim gets.
    expect(results[4 + 1]).toBeUndefined();
  });

  it("budgets the subject, never the submitter", async () => {
    // The whole reason this bucket exists. A party names up to six people, so a
    // key on whoever posted the form is cleared by putting the victim in seat
    // two with a fresh address — only a key on the address written *to* bounds
    // how often one record can be written.
    await drain("first-subject@example.invalid");
    expect(
      await declarationWithinPersonBudget(claim, {
        shopId: SHOP,
        email: "second-subject@example.invalid",
      }),
    ).toEqual(claim);
  });

  it("keeps one shop's spray out of the same diver's budget at another", async () => {
    const shared = "travels-a-lot@example.invalid";
    await drain(shared, "shop-b");
    expect(await declarationWithinPersonBudget(claim, { shopId: "shop-c", email: shared })).toEqual(
      claim,
    );
  });

  it("treats one address written two ways as one address", async () => {
    // Otherwise the bucket is cleared by holding down the shift key.
    const email = "Mixed.Case@Example.invalid";
    await drain(email);
    expect(
      await declarationWithinPersonBudget(claim, {
        shopId: SHOP,
        email: "  mixed.case@example.INVALID  ",
      }),
    ).toBeUndefined();
  });

  it("spends nothing when the joiner said nothing", async () => {
    // A sign-up with no answer to the certification question writes no record,
    // so it has none to protect — and an honest joiner who skips the question
    // must never exhaust their own budget by signing up.
    const email = "quiet-joiner@example.invalid";
    for (let i = 0; i < 20; i += 1) {
      expect(
        await declarationWithinPersonBudget(undefined, { shopId: SHOP, email }),
      ).toBeUndefined();
    }
    expect(await declarationWithinPersonBudget(claim, { shopId: SHOP, email })).toEqual(claim);
  });
});
