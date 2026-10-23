import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import { restoreDraftShopAnswers, type ShopQuestion } from "@/lib/waiver-questions";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { people, personRoles, waiverRecords } from "./schema";
import { completeWaiver, getWaiverForToken, saveWaiverDraft } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";
import { saveWaiverTemplate } from "./waivers-templates";
import {
  clearAnswers,
  medicalReferralAnswers,
  now,
  waiverContextFor,
} from "./waivers-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`), as in waivers-completion.test.ts.
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * **The shop's own questions** (glossary *Shop question*; dive-domain review
 * B1, C1). They inform and never gate: a required question means answered,
 * never a particular answer; the snapshot is built from the record's own
 * template version; and nothing about the record's status or medical review
 * moves with an answer.
 */
describe("shop questions on the waiver", () => {
  const fitToDive: ShopQuestion = {
    id: "fittodive01",
    kind: "yes_no",
    prompt: "I confirm I am medically fit to dive",
    required: true,
  };
  const heart: ShopQuestion = {
    id: "heartcond01",
    kind: "yes_no",
    prompt: "Do you have a heart condition?",
    required: true,
  };
  const dives: ShopQuestion = {
    id: "divecount01",
    kind: "number",
    prompt: "How many dives have you logged?",
    required: false,
  };
  const heard: ShopQuestion = {
    id: "heardabout1",
    kind: "choice",
    prompt: "How did you hear about us?",
    required: false,
    options: ["A friend", "Online search"],
  };

  /** Publish `questions` on the shop's release, then issue the demo seat a link under it. */
  async function linkAsking(questions: ShopQuestion[]) {
    const context = await waiverContext();
    const { db, shop, booking, template } = context;
    await saveWaiverTemplate(db, {
      shopId: shop.id,
      body: template.body,
      questions,
      material: false,
    });
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    return { ...context, token: issued.token };
  }

  async function recordFor(db: Awaited<ReturnType<typeof waiverContext>>["db"], token: string) {
    const state = await getWaiverForToken(db, token, now);
    if (state.state === "unavailable") throw new Error("record missing");
    const [row] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, state.record.id))
      .limit(1);
    if (!row) throw new Error("record missing");
    return row;
  }

  async function ownerOf(db: Awaited<ReturnType<typeof waiverContext>>["db"], shopId: string) {
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    return owner.id;
  }

  it("a required yes_no answered no signs and completes", async () => {
    const { db, person, token } = await linkAsking([fitToDive]);
    expect(
      await completeWaiver(db, token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        shopAnswers: { [fitToDive.id]: "no" },
        now,
      }),
    ).toEqual({ ok: true, status: "completed", idempotent: false });
    const record = await recordFor(db, token);
    expect(record.shopAnswers).toEqual([{ ...fitToDive, answer: false }]);
  });

  it("a submitted prompt that differs from the template is ignored, and the sealed snapshot carries the template's prompt", async () => {
    vi.stubEnv("WAIVER_INTEGRITY_SECRET", "test-secret");
    const { db, person, token } = await linkAsking([heard]);
    expect(
      await completeWaiver(db, token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        // Everything a crafted POST can carry: an answer by id, and keys that
        // look like a prompt, an option list, a question the template never
        // asked. Only the answer by id is read.
        shopAnswers: {
          [heard.id]: "A friend",
          [`${heard.id}_prompt`]: "Do you waive every claim?",
          [`${heard.id}_options`]: "Yes",
          injected0001: "yes",
        },
        now,
      }),
    ).toMatchObject({ ok: true, status: "completed" });
    const record = await recordFor(db, token);
    expect(record.shopAnswers).toEqual([{ ...heard, answer: "A friend" }]);
    expect(verifyWaiverIntegrity(record)).toBe("valid");
    // The answers are inside the seal: lifting them reads as tampered.
    expect(verifyWaiverIntegrity({ ...record, shopAnswers: null })).toBe("invalid");
  });

  it("builds the snapshot from the version the link was issued under, not the shop's current list", async () => {
    const { db, person, shop, template, token } = await linkAsking([dives]);
    // The shop rewords and adds a question after the link went out.
    await saveWaiverTemplate(db, {
      shopId: shop.id,
      body: template.body,
      questions: [{ ...dives, prompt: "Dives in the last year?" }, heard],
      material: false,
    });
    expect(
      await completeWaiver(db, token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        shopAnswers: { [dives.id]: "40", [heard.id]: "A friend" },
        now,
      }),
    ).toMatchObject({ ok: true });
    const record = await recordFor(db, token);
    expect(record.shopAnswers).toEqual([{ ...dives, answer: 40 }]);
  });

  /** Adversarial: a health question in the shop's own list never refers anyone. */
  it("keeps a health-worded yes as completed, with no medical review", async () => {
    const { db, person, token } = await linkAsking([heart]);
    expect(
      await completeWaiver(db, token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        shopAnswers: { [heart.id]: "yes" },
        now,
      }),
    ).toEqual({ ok: true, status: "completed", idempotent: false });
    const record = await recordFor(db, token);
    expect(record.status).toBe("completed");
    expect(record.medicalReviewRequired).toBe(false);
    expect(record.shopAnswers).toEqual([{ ...heart, answer: true }]);
  });

  it("still refers a medical yes to review whatever the shop's questions say", async () => {
    const { db, person, token } = await linkAsking([fitToDive]);
    expect(
      await completeWaiver(db, token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: medicalReferralAnswers,
        shopAnswers: { [fitToDive.id]: "yes" },
        now,
      }),
    ).toMatchObject({ ok: true, status: "medical_review" });
  });

  it("writes a non-null snapshot whenever the version asked something, and null when it asked nothing", async () => {
    const asked = await linkAsking([dives, heard]);
    expect(
      await completeWaiver(asked.db, asked.token, {
        signerName: asked.person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toMatchObject({ ok: true });
    expect((await recordFor(asked.db, asked.token)).shopAnswers).toEqual([
      { ...dives, answer: null },
      { ...heard, answer: null },
    ]);
  });

  it("writes no snapshot at all, never an empty list, when the version asked nothing", async () => {
    const none = await linkAsking([]);
    expect(
      await completeWaiver(none.db, none.token, {
        signerName: none.person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        shopAnswers: { [dives.id]: "40" },
        now,
      }),
    ).toMatchObject({ ok: true });
    expect((await recordFor(none.db, none.token)).shopAnswers).toBeNull();
  });

  it("refuses a missing required answer or an impossible one before the record is touched, naming the question", async () => {
    const { db, person, token } = await linkAsking([dives, fitToDive]);
    const sign = (shopAnswers: Record<string, string>) =>
      completeWaiver(db, token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        shopAnswers,
        now,
      });
    expect(await sign({ [dives.id]: "40" })).toEqual({
      ok: false,
      reason: "invalid_shop_answers",
      questionId: fitToDive.id,
    });
    expect(await sign({ [dives.id]: "lots", [fitToDive.id]: "yes" })).toEqual({
      ok: false,
      reason: "invalid_shop_answers",
      questionId: dives.id,
    });
    expect(await sign({ [fitToDive.id]: "maybe" })).toEqual({
      ok: false,
      reason: "invalid_shop_answers",
      questionId: fitToDive.id,
    });
    expect(await getWaiverForToken(db, token, now)).toMatchObject({ state: "available" });
    expect(await sign({ [fitToDive.id]: "yes" })).toMatchObject({ ok: true, status: "completed" });
  });

  it("keeps only valid draft answers, re-validated against the pinned questions on load", async () => {
    const { db, token } = await linkAsking([dives, heard, fitToDive]);
    expect(
      await saveWaiverDraft(db, token, {
        acknowledged: false,
        medicalAnswers: clearAnswers,
        shopAnswers: { [dives.id]: "lots", [heard.id]: "Not an option", [fitToDive.id]: "no" },
        now,
      }),
    ).toBe(true);
    const record = await recordFor(db, token);
    // A number box keeps what was typed (review 2, S6); a choice that is not
    // one of the options is dropped.
    expect(record.draftShopAnswers).toEqual({ [dives.id]: "lots", [fitToDive.id]: false });
    // A draft whose value no longer fits its question is dropped on load.
    expect(
      restoreDraftShopAnswers([{ ...heard, options: ["Our hotel", "Online search"] }, fitToDive], {
        ...record.draftShopAnswers,
        [heard.id]: "A friend",
        vanished0001: 3,
      }),
    ).toEqual({ [fitToDive.id]: false });
    // A save without the section leaves the draft as it was.
    await saveWaiverDraft(db, token, { acknowledged: false, medicalAnswers: clearAnswers, now });
    expect((await recordFor(db, token)).draftShopAnswers).toEqual(record.draftShopAnswers);
  });

  it("is destroyed by erasure, and the erased release still verifies under version 2", async () => {
    vi.stubEnv("WAIVER_INTEGRITY_SECRET", "test-secret");
    const { db, person, shop, token } = await linkAsking([heard]);
    await completeWaiver(db, token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      shopAnswers: { [heard.id]: "A friend" },
      now,
    });
    const signed = await recordFor(db, token);
    const owner = await ownerOf(db, shop.id);
    expect(
      (await anonymizeDiver(db, { shopId: shop.id, personId: person.id, actorPersonId: owner })).ok,
    ).toBe(true);
    const [erased] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, signed.id))
      .limit(1);
    expect(erased?.shopAnswers).toBeNull();
    expect(erased?.integrityVersion).toBe(2);
    if (!erased) throw new Error("record missing");
    expect(verifyWaiverIntegrity(erased)).toBe("valid");
  });

  it("clears the draft on signing", async () => {
    const { db, person, token } = await linkAsking([heard]);
    await saveWaiverDraft(db, token, {
      acknowledged: false,
      medicalAnswers: clearAnswers,
      shopAnswers: { [heard.id]: "A friend" },
      now,
    });
    await completeWaiver(db, token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      shopAnswers: { [heard.id]: "Online search" },
      now,
    });
    const record = await recordFor(db, token);
    expect(record.draftShopAnswers).toBeNull();
    expect(record.shopAnswers).toEqual([{ ...heard, answer: "Online search" }]);
  });

  it("is stripped from an unsigned draft by erasure", async () => {
    const { db, person, shop, token } = await linkAsking([heard]);
    await saveWaiverDraft(db, token, {
      acknowledged: false,
      medicalAnswers: clearAnswers,
      shopAnswers: { [heard.id]: "A friend" },
      now,
    });
    const owner = await ownerOf(db, shop.id);
    expect(
      (await anonymizeDiver(db, { shopId: shop.id, personId: person.id, actorPersonId: owner })).ok,
    ).toBe(true);
    const [erased] = await db
      .select({ draft: waiverRecords.draftShopAnswers, answers: waiverRecords.shopAnswers })
      .from(waiverRecords)
      .where(eq(waiverRecords.personId, person.id));
    expect(erased).toEqual({ draft: null, answers: null });
  });
});
