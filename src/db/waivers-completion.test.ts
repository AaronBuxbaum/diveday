import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyMedicalAnswers, findQuestionnaireVersion, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { getBookingReadiness } from "./readiness";
import { bookings, people, shops, waiverRecords } from "./schema";
import { listStaff } from "./trips";
import { listSignedWaiversByPerson } from "./waivers-audit";
import {
  completeWaiver,
  getEmergencyContactForBearer,
  getWaiverForToken,
  saveBookingEmergencyContact,
  saveWaiverDraft,
} from "./waivers-completion";
import { recordInPersonWaiver } from "./waivers-in-person";
import { issueWaiverRequest } from "./waivers-requests";
import {
  clearAnswers,
  medicalReferralAnswers,
  now,
  waiverContextFor,
} from "./waivers-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("waiver records (in-memory PGlite)", () => {
  it("makes completion idempotent and routes a medical yes to review", async () => {
    const { db, person, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now,
    });
    if (!issued.ok) throw new Error("expected a waiver link");
    const input = {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now,
    };
    expect(await completeWaiver(db, issued.token, input)).toEqual({
      ok: true,
      status: "medical_review",
      idempotent: false,
    });
    expect(await completeWaiver(db, issued.token, input)).toEqual({
      ok: true,
      status: "medical_review",
      idempotent: true,
    });
  });

  it("clears a question 1 yes when every Box A answer is no", async () => {
    const { db, person, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    const medicalAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
    medicalAnswers.responses.q1 = true;
    for (const question of RSTC_QUESTIONNAIRE.questions.filter((q) => q.parentId === "q1")) {
      medicalAnswers.responses[question.id] = false;
    }
    expect(
      await completeWaiver(db, issued.token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers,
        now,
      }),
    ).toMatchObject({ ok: true, status: "completed" });
  });

  /**
   * **Readable is not signable.** v2 stays in `findQuestionnaireVersion` so an
   * already-signed record can still be interpreted under the questions its
   * diver actually answered. It must never be a set of questions somebody can
   * sign *today*: `completeWaiver` takes the version from the client, so
   * without `requireCurrent` a caller could answer the corrected form under the
   * version it corrected — and v2's dental question is exactly the item v3
   * moved into Box C behind a question 4 yes. An all-no v2 set computes
   * `clear`, so this is refused for its version and nothing else.
   */
  it("refuses a retired questionnaire version for a new signature", async () => {
    const { db, person, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    const retired = findQuestionnaireVersion(RSTC_QUESTIONNAIRE.id, 2);
    if (!retired) throw new Error("v2 must stay readable for already-signed records");

    expect(
      await completeWaiver(db, issued.token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: emptyMedicalAnswers(retired),
        now,
      }),
    ).toEqual({ ok: false, reason: "invalid_medical" });
    // Refused before the record was touched, like every other refusal here:
    // the diver comes back to a link they can still sign under v3.
    expect(await getWaiverForToken(db, issued.token, now)).toMatchObject({ state: "available" });

    expect(
      await completeWaiver(db, issued.token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toMatchObject({ ok: true, status: "completed" });
  });

  /**
   * "Type your full name" *is* the signature, so it has to be the signer's
   * name. It used to accept any two characters, which meant a release could be
   * executed under "asdf" and still read as signed on the manifest.
   */
  it("refuses a signature typed under someone else's name, leaving the link signable", async () => {
    const { db, person, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now,
    });
    if (!issued.ok) throw new Error("expected a waiver link");

    expect(
      await completeWaiver(db, issued.token, {
        signerName: "Somebody Else",
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toEqual({ ok: false, reason: "name_mismatch" });
    // Refused before the record was touched: the diver can still sign.
    expect(await getWaiverForToken(db, issued.token, now)).toMatchObject({ state: "available" });

    expect(
      await completeWaiver(db, issued.token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toMatchObject({ ok: true, status: "completed" });
  });

  it("accepts the noise that isn't a different person — case, accents, and a middle initial", async () => {
    const { db, shop, booking, person } = await waiverContext();
    await db.update(people).set({ fullName: "José Q. Díaz" }).where(eq(people.id, person.id));
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now,
    });
    if (!issued.ok) throw new Error("expected a waiver link");

    expect(
      await completeWaiver(db, issued.token, {
        signerName: "  jose diaz ",
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toMatchObject({ ok: true, status: "completed" });
  });
});

describe("emergency contact captured with the waiver", () => {
  it("writes the diver's emergency contact to their person record on completion", async () => {
    const { db, person, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);

    const outcome = await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      emergencyContact: { name: "Sam Quinn", phone: "+1 305 555 0114" },
      now,
    });
    expect(outcome.ok).toBe(true);

    await expect(getEmergencyContactForBearer(db, booking.id)).resolves.toMatchObject({
      name: "Sam Quinn",
      phone: "+1 305 555 0114",
    });
  });

  it("never splices a new name onto the contact's old number", async () => {
    const { db, person, shop, booking } = await waiverContext();
    await db
      .update(people)
      .set({ emergencyContactName: "Old Contact", emergencyContactPhone: "555-0000" })
      .where(eq(people.id, booking.personId));
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);

    // The page refuses this shape before it gets here; the writer refuses it
    // again, because a half pair reaching the record is the whole hazard.
    const outcome = await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      emergencyContact: { name: "New Person", phone: "" },
      now,
    });

    expect(outcome.ok).toBe(true);
    await expect(getEmergencyContactForBearer(db, booking.id)).resolves.toMatchObject({
      name: "Old Contact",
      phone: "555-0000",
    });
  });

  it("never wipes a contact already on file when the diver leaves it blank", async () => {
    const { db, person, shop, booking } = await waiverContext();
    await db
      .update(people)
      .set({ emergencyContactName: "Existing Contact", emergencyContactPhone: "555-0000" })
      .where(eq(people.id, booking.personId));
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);

    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      emergencyContact: { name: "", phone: "" },
      now,
    });

    await expect(getEmergencyContactForBearer(db, booking.id)).resolves.toMatchObject({
      name: "Existing Contact",
      phone: "555-0000",
    });
  });
});

// The roster's staff-facing capture (task 144) calls `saveBookingEmergencyContact`
// directly rather than through a bearer token, so its shop-scoping is the only
// thing standing between a staffer and another shop's booking — covered here
// rather than only indirectly through `completeWaiver`.
describe("saveBookingEmergencyContact (staff-facing write path, task 144)", () => {
  it("writes a contact for a booking scoped to the given shop", async () => {
    const { db, shop, booking } = await waiverContext();
    const saved = await saveBookingEmergencyContact(db, {
      shopId: shop.id,
      bookingId: booking.id,
      name: "Alex Rivera",
      phone: "+1 305 555 0133",
      actor: "staff",
    });
    expect(saved).toBe(true);
    await expect(getEmergencyContactForBearer(db, booking.id)).resolves.toMatchObject({
      name: "Alex Rivera",
      phone: "+1 305 555 0133",
    });
  });

  it("refuses to write when the booking belongs to a different shop", async () => {
    const { db, booking } = await waiverContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-emergency-contact-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    // The seeded demo diver may already carry a contact — capture whatever it
    // actually is rather than assume null, so this asserts nothing changed,
    // not a specific starting value.
    const before = await getEmergencyContactForBearer(db, booking.id);

    const saved = await saveBookingEmergencyContact(db, {
      shopId: otherShop.id,
      bookingId: booking.id,
      name: "Should Not Land",
      phone: "+1 000 000 0000",
      actor: "staff",
    });
    expect(saved).toBe(false);
    await expect(getEmergencyContactForBearer(db, booking.id)).resolves.toEqual(before);
  });

  // The splice these two refuse is written out over
  // `EmergencyContactSubmission` in `src/lib/contact.ts`. The writer restates
  // the refusal rather than trusting its callers: this is the write a
  // bearer-token page reaches.
  it("writes nothing when a name arrives with the number cleared", async () => {
    const { db, shop, booking } = await waiverContext();
    await db
      .update(people)
      .set({ emergencyContactName: "Old Contact", emergencyContactPhone: "555-0000" })
      .where(eq(people.id, booking.personId));

    const saved = await saveBookingEmergencyContact(db, {
      shopId: shop.id,
      bookingId: booking.id,
      name: "New Person",
      phone: "   ",
      actor: "staff",
    });

    expect(saved).toBe(false);
    await expect(getEmergencyContactForBearer(db, booking.id)).resolves.toMatchObject({
      name: "Old Contact",
      phone: "555-0000",
    });
  });

  it("writes nothing when a number arrives with the name cleared", async () => {
    const { db, shop, booking } = await waiverContext();
    await db
      .update(people)
      .set({ emergencyContactName: "Old Contact", emergencyContactPhone: "555-0000" })
      .where(eq(people.id, booking.personId));

    const saved = await saveBookingEmergencyContact(db, {
      shopId: shop.id,
      bookingId: booking.id,
      name: "",
      phone: "555-0111",
      actor: "staff",
    });

    expect(saved).toBe(false);
    await expect(getEmergencyContactForBearer(db, booking.id)).resolves.toMatchObject({
      name: "Old Contact",
      phone: "555-0000",
    });
  });

  /**
   * **The tenant is restated on the write, not inherited from the read.** The
   * booking read above it proves the booking is this shop's; nothing in it
   * proves `bookings.person_id` points at a person inside the shop. This is the
   * write a bearer-token page reaches, so the day a row goes wrong that way it
   * has to be non-exploitable rather than merely unlikely.
   */
  it("writes nothing when the booking's person belongs to another shop", async () => {
    const { db, shop, booking } = await waiverContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-cross-tenant-person", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    const [stranger] = await db
      .insert(people)
      .values({
        shopId: otherShop.id,
        fullName: "Stranger Diver",
        emergencyContactName: "Their Own Contact",
        emergencyContactPhone: "555-0042",
      })
      .returning();
    if (!stranger) throw new Error("stranger insert failed");
    await db.update(bookings).set({ personId: stranger.id }).where(eq(bookings.id, booking.id));

    const saved = await saveBookingEmergencyContact(db, {
      shopId: shop.id,
      bookingId: booking.id,
      name: "Should Not Land",
      phone: "+1 000 000 0000",
      actor: "staff",
    });

    expect(saved).toBe(false);
    const [after] = await db
      .select({
        name: people.emergencyContactName,
        phone: people.emergencyContactPhone,
      })
      .from(people)
      .where(eq(people.id, stranger.id));
    expect(after).toEqual({ name: "Their Own Contact", phone: "555-0042" });
  });

  it("is a no-op when both fields are blank, never wiping what's on file", async () => {
    const { db, shop, booking } = await waiverContext();
    await db
      .update(people)
      .set({ emergencyContactName: "Kept Contact", emergencyContactPhone: "555-0099" })
      .where(eq(people.id, booking.personId));

    const saved = await saveBookingEmergencyContact(db, {
      shopId: shop.id,
      bookingId: booking.id,
      name: "   ",
      phone: "",
      actor: "staff",
    });
    expect(saved).toBe(false);
    await expect(getEmergencyContactForBearer(db, booking.id)).resolves.toMatchObject({
      name: "Kept Contact",
      phone: "555-0099",
    });
  });
});

describe("an emergency contact on a held seat", () => {
  // Issue #2082: a held seat may be a different human from the matched person,
  // so its bearer links must neither read nor overwrite that person's contact.
  // Staff, who can see who is standing at the counter, still can.
  async function heldSeat(given?: Awaited<ReturnType<typeof waiverContext>>) {
    const ctx = given ?? (await waiverContext());
    await ctx.db
      .update(people)
      .set({ emergencyContactName: "Kept Contact", emergencyContactPhone: "555-0099" })
      .where(eq(people.id, ctx.booking.personId));
    await ctx.db
      .update(bookings)
      .set({ identityUnconfirmedAt: now })
      .where(eq(bookings.id, ctx.booking.id));
    return ctx;
  }
  async function contactOnFile(db: Awaited<ReturnType<typeof heldSeat>>["db"], personId: string) {
    const [row] = await db
      .select({ name: people.emergencyContactName, phone: people.emergencyContactPhone })
      .from(people)
      .where(eq(people.id, personId));
    return row;
  }

  it("reads back blank to the bearer page", async () => {
    const { db, booking } = await heldSeat();
    await expect(getEmergencyContactForBearer(db, booking.id)).resolves.toMatchObject({
      name: null,
      phone: null,
      held: true,
    });
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null })
      .where(eq(bookings.id, booking.id));
    await expect(getEmergencyContactForBearer(db, booking.id)).resolves.toMatchObject({
      name: "Kept Contact",
      phone: "555-0099",
      held: false,
    });
  });

  it("refuses the bearer and leaves the matched person's contact alone", async () => {
    const { db, shop, booking } = await heldSeat();
    const saved = await saveBookingEmergencyContact(db, {
      shopId: shop.id,
      bookingId: booking.id,
      name: "Someone Else",
      phone: "555-0123",
      actor: "bearer",
    });
    expect(saved).toBe(false);
    await expect(contactOnFile(db, booking.personId)).resolves.toEqual({
      name: "Kept Contact",
      phone: "555-0099",
    });

    expect(
      await saveBookingEmergencyContact(db, {
        shopId: shop.id,
        bookingId: booking.id,
        name: "Staff Entered",
        phone: "555-0124",
        actor: "staff",
      }),
    ).toBe(true);
    await expect(contactOnFile(db, booking.personId)).resolves.toEqual({
      name: "Staff Entered",
      phone: "555-0124",
    });
  });

  // A held seat is issued no link and signs nothing now (issue #2125), so a
  // release on one is a record signed before the seat was held; the readers
  // below still treat it as the seat's, not the matched person's.
  async function signedThenHeld(medicalAnswers: typeof clearAnswers) {
    const ctx = await waiverContext();
    const issued = await issueWaiverRequest(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.booking.id,
      now,
    });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    await completeWaiver(ctx.db, issued.token, {
      signerName: ctx.person.fullName,
      agreed: true,
      medicalAnswers,
      now,
    });
    await ctx.db
      .update(bookings)
      .set({ identityUnconfirmedAt: now })
      .where(eq(bookings.id, ctx.booking.id));
    return { ...ctx, issued };
  }

  it("does not let a clean release signed there carry to the diver's other bookings", async () => {
    const { db, shop, booking, issued } = await signedThenHeld(clearAnswers);
    const carried = async () =>
      (
        (await listSignedWaiversByPerson(db, shop.id, [booking.personId])).get(booking.personId) ??
        []
      ).map((record) => record.id);
    expect(await carried()).not.toContain(issued.recordId);

    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null })
      .where(eq(bookings.id, booking.id));
    expect(await carried()).toContain(issued.recordId);
  });

  it("still carries a medical hold signed there, failing toward the hold", async () => {
    const { db, shop, booking, issued } = await signedThenHeld(medicalReferralAnswers);
    const signed =
      (await listSignedWaiversByPerson(db, shop.id, [booking.personId])).get(booking.personId) ??
      [];
    expect(signed.map((record) => record.id)).toContain(issued.recordId);
  });

  it("does not land a contact typed into the waiver onto the matched person", async () => {
    // A link issued before the seat was held: the signature is refused whole,
    // contact and all (issue #2125).
    const ctx = await waiverContext();
    const issued = await issueWaiverRequest(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.booking.id,
      now,
    });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    const { db, person, booking } = await heldSeat(ctx);
    expect(
      await completeWaiver(db, issued.token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        emergencyContact: { name: "Someone Else", phone: "555-0123" },
        now,
      }),
    ).toEqual({ ok: false, reason: "identity_unconfirmed" });
    await expect(contactOnFile(db, booking.personId)).resolves.toEqual({
      name: "Kept Contact",
      phone: "555-0099",
    });
  });
});

/**
 * **A minor's release is signed twice** (ADR 20260907-guardian-co-signature).
 *
 * Safety-critical and adversarial by nature: the whole point of a second signer
 * is that they are somebody else, so the cases that matter are the ones where a
 * twelve-year-old tries to be both. The pure rule lives in `src/lib/guardian.ts`
 * and is tested there; what is pinned here is what the *writers* do with it —
 * refuse before touching the record, write all six columns inside the seal, and
 * decline to treat a solo minor signature as a release that already stands.
 */
describe("the guardian co-signature (ADR 20260907-guardian-co-signature)", () => {
  /** Twelve years old on the demo shop's calendar day at `now`. */
  const MINOR_DOB = "2014-05-01";

  const guardian = {
    name: "Jonas Fischer",
    relationship: "parent",
    email: "Jonas@Example.com ",
    agreed: true,
  };

  /** Put a date of birth on the seat's diver, which is what turns the rule on. */
  async function makeMinor(
    db: Awaited<ReturnType<typeof waiverContext>>["db"],
    personId: string,
    dateOfBirth = MINOR_DOB,
  ) {
    await db.update(people).set({ dateOfBirth }).where(eq(people.id, personId));
  }

  async function liveLink(ctx: Awaited<ReturnType<typeof waiverContext>>) {
    const issued = await issueWaiverRequest(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.booking.id,
      now,
    });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    return issued;
  }

  it("refuses a minor signing alone, and leaves the link signable", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const issued = await liveLink(ctx);

    expect(
      await completeWaiver(ctx.db, issued.token, {
        signerName: ctx.person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toEqual({ ok: false, reason: "guardian_required" });

    // A family that missed the section keeps the link they were sent.
    expect(await getWaiverForToken(ctx.db, issued.token, now)).toMatchObject({
      state: "available",
    });
  });

  /**
   * **A father and son of the same legal name.** The refusal above exists to
   * stop a minor signing as their own guardian, so it must not be relaxed — but
   * a real family has to be able to get through, and the error used to name no
   * way out at all. It now names three, and this is what makes them true.
   *
   * The first two are the honest ones: another parent signs, or the parent
   * writes more of his *own* name. Both leave the release naming the adult who
   * actually assumed the risk, which is the whole evidentiary point of the
   * printed guardian name.
   *
   * The copy says a middle name **in full** because a middle *initial* does not
   * escape the refusal: `significantNameTokens` drops tokens shorter than two
   * characters, so "John Q. Smith" and "John Smith" are the same two tokens.
   * Advice that said only "add your middle name" would fail the exact parent
   * who followed it (dive-domain review, 2026-09-08).
   */
  it("lets a same-named family through by the routes the error names", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    await ctx.db.update(people).set({ fullName: "John Smith" }).where(eq(people.id, ctx.person.id));

    // A middle initial is dropped, so this is still the diver's own name.
    const initial = await liveLink(ctx);
    expect(
      await completeWaiver(ctx.db, initial.token, {
        signerName: "John Smith",
        agreed: true,
        medicalAnswers: clearAnswers,
        guardian: { ...guardian, name: "John Q. Smith" },
        now,
      }),
    ).toEqual({ ok: false, reason: "guardian_invalid" });

    // The other parent: the cheapest way through, and the one the error now
    // offers first. Nothing has to be typed differently from the truth.
    expect(
      await completeWaiver(ctx.db, initial.token, {
        signerName: "John Smith",
        agreed: true,
        medicalAnswers: clearAnswers,
        guardian: { ...guardian, name: "Mary Smith" },
        now,
      }),
    ).toMatchObject({ ok: true, status: "completed" });

    const [byOtherParent] = await db_record(ctx, initial.recordId);
    expect(byOtherParent).toMatchObject({ guardianName: "Mary Smith" });
  });

  /**
   * The same-named parent signing alone, with his middle name written out.
   *
   * A separate seat because the route above already completed that waiver, and
   * because this is the case that decides what ends up printed on a minor's
   * release: the father's own fuller name, never a suffix. Told to "add a
   * suffix like Jr." a father writes **his son's** legal name, and a reader
   * opening the file later sees a release where diver and co-signer are the
   * same person — the exact thing the refusal exists to prevent (dive-domain
   * review, 2026-09-08). The copy does not offer that, and neither does this.
   */
  it("accepts a same-named parent who writes his middle name in full", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    await ctx.db.update(people).set({ fullName: "John Smith" }).where(eq(people.id, ctx.person.id));
    const issued = await liveLink(ctx);

    expect(
      await completeWaiver(ctx.db, issued.token, {
        signerName: "John Smith",
        agreed: true,
        medicalAnswers: clearAnswers,
        guardian: { ...guardian, name: "John Michael Smith" },
        now,
      }),
    ).toMatchObject({ ok: true, status: "completed" });

    const [record] = await db_record(ctx, issued.recordId);
    expect(record).toMatchObject({ guardianName: "John Michael Smith" });
  });

  it("refuses a guardian section that is not a signature", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);

    for (const bad of [
      // The diver typing their own name twice: one signature in two hats, and
      // the single case a browser's `required` attributes cannot catch.
      { ...guardian, name: ctx.person.fullName },
      // A relationship this product does not have a word for.
      { ...guardian, relationship: "uncle" },
      // Blank is now accepted (issue #1453) but a *typed* address that is not
      // one is still a refusal, never a silent null: the page dropped
      // `required`, so this writer-side shape check is the enforcement of
      // record for anything a hand-built request sends.
      { ...guardian, email: "not-an-address" },
      { ...guardian, email: "  parent@ " },
      // A typed name is not a signature until the guardian's own box is ticked.
      { ...guardian, agreed: false },
    ]) {
      const issued = await liveLink(ctx);
      expect(
        await completeWaiver(ctx.db, issued.token, {
          signerName: ctx.person.fullName,
          agreed: true,
          medicalAnswers: clearAnswers,
          guardian: bad,
          now,
        }),
      ).toEqual({ ok: false, reason: "guardian_invalid" });
      expect(await getWaiverForToken(ctx.db, issued.token, now)).toMatchObject({
        state: "available",
      });
    }
  });

  /**
   * **The family with no address** (issue #1453, owner decision 2026-09-10:
   * "send a copy where there is an address, and stop refusing a family that
   * has none").
   *
   * A grandparent at a counter with no email, or a household sharing the one
   * the diver already gave, was refused outright — while the column they were
   * being made to fill had no reader at all. It is optional now, stored null,
   * and the release is a release.
   */
  it("records a co-signature with no guardian address, and seals it", async () => {
    vi.stubEnv("WAIVER_INTEGRITY_SECRET", "test-secret");
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const issued = await liveLink(ctx);

    expect(
      await completeWaiver(ctx.db, issued.token, {
        signerName: ctx.person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        guardian: { ...guardian, email: "" },
        now,
      }),
    ).toMatchObject({ ok: true });

    const [record] = await db_record(ctx, issued.recordId);
    expect(record).toMatchObject({
      guardianName: "Jonas Fischer",
      guardianRelationship: "parent",
      guardianEmail: null,
      guardianSignatureMethod: "typed_consent",
    });
    if (!record) throw new Error("expected a record row");
    expect(verifyWaiverIntegrity(record)).toBe("valid");
    // The boarding gate is cleared by the signature, never by the address.
    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.booking.id);
    expect(readiness?.blockers ?? []).not.toContainEqual(
      expect.objectContaining({ code: "guardian_signature_missing" }),
    );
  });

  it("writes the co-signature, seals it, and clears the boarding gate", async () => {
    vi.stubEnv("WAIVER_INTEGRITY_SECRET", "test-secret");
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const issued = await liveLink(ctx);

    expect(
      await completeWaiver(ctx.db, issued.token, {
        signerName: ctx.person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        guardian,
        now,
      }),
    ).toMatchObject({ ok: true, status: "completed" });

    const [record] = await db_record(ctx, issued.recordId);
    expect(record).toMatchObject({
      guardianName: "Jonas Fischer",
      guardianRelationship: "parent",
      // Trimmed and lower-cased, like every other address the product stores.
      guardianEmail: "jonas@example.com",
      guardianSignatureMethod: "typed_consent",
    });
    expect(record?.guardianSignedAt).not.toBeNull();
    expect(record?.guardianConsentedAt).not.toBeNull();
    // The draft of the section goes with the rest of the unsubmitted state.
    expect(record?.draftGuardian).toBeNull();
    expect(verifyWaiverIntegrity(record)).toBe("valid");

    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.booking.id);
    expect(readiness?.blockers ?? []).not.toContainEqual(
      expect.objectContaining({ code: "guardian_signature_missing" }),
    );
  });

  /**
   * The backfill case, and the one a shop will actually meet: the release was
   * signed before anyone asked the diver's age, and the date of birth lands
   * afterwards. The standing signature becomes a blocker rather than a silent
   * pass, and the ordinary "send the waiver" tap mints a fresh link instead of
   * answering "already signed".
   */
  it("turns a release signed before the date of birth landed into a blocker, and re-issues over it", async () => {
    const ctx = await waiverContext();
    const issued = await liveLink(ctx);
    expect(
      await completeWaiver(ctx.db, issued.token, {
        signerName: ctx.person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toMatchObject({ ok: true });

    // Before the date of birth: an ordinary signed release, and no second link.
    expect(
      await issueWaiverRequest(ctx.db, { shopId: ctx.shop.id, bookingId: ctx.booking.id, now }),
    ).toEqual({ ok: false, reason: "already_completed" });

    await makeMinor(ctx.db, ctx.person.id);

    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.booking.id);
    expect(readiness?.blockers).toContainEqual(
      expect.objectContaining({ code: "guardian_signature_missing" }),
    );
    const reissued = await issueWaiverRequest(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.booking.id,
      now,
    });
    expect(reissued.ok).toBe(true);
  });

  /**
   * The two edits a front desk is told to try when a father and son share a
   * name. `personNamesMatch` compares tokens of two characters or more, so the
   * initial changes nothing and the spelled-out name changes everything —
   * stated here as fixtures rather than in prose, because the notice's advice
   * is only worth giving if it is true.
   */
  const withMiddleInitial = (name: string) => {
    const [first, ...rest] = name.split(" ");
    return [first, "A", ...rest].join(" ");
  };
  const withMiddleName = (name: string) => {
    const [first, ...rest] = name.split(" ");
    return [first, "Aurelio", ...rest].join(" ");
  };

  it("holds the paper path to the same rule, and records the staffer's attestation of it", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const [staff] = await listStaff(ctx.db, ctx.shop.id);
    if (!staff) throw new Error("demo staff missing");

    const attempt = (guardianInput?: {
      name: string;
      relationship: string;
      namesakeAttested?: boolean;
    }) =>
      recordInPersonWaiver(ctx.db, {
        shopId: ctx.shop.id,
        subject: { bookingId: ctx.booking.id },
        recordedByPersonId: staff.person.id,
        medicalAttested: true,
        guardian: guardianInput,
        now,
      });

    expect(await attempt()).toEqual({ ok: false, reason: "guardian_required" });
    // **The three refusals are not one refusal** (issue 1539). These two keep
    // the generic notice: retyping fixes the first, and the second cannot come
    // from the form at all, whose `<select>` offers only the two codes.
    //
    // `"J "` rather than whitespace: `paperGuardianFrom` drops a blank name, so
    // that lands on `guardian_required` above and no surface can produce it
    // here. This one can — the browser counts `minLength` on the raw value and
    // `inPersonAttestationProvider.capture` trims first.
    expect(await attempt({ name: "J ", relationship: "parent" })).toEqual({
      ok: false,
      reason: "guardian_invalid",
    });
    expect(await attempt({ name: "Jonas Fischer", relationship: "uncle" })).toEqual({
      ok: false,
      reason: "guardian_invalid",
    });
    // This one the form produces from an honest submission: a family who share
    // a legal name. It keeps its own reason so the staffer who typed it can be
    // told what to do, since "try again" cannot work.
    expect(await attempt({ name: ctx.person.fullName, relationship: "parent" })).toEqual({
      ok: false,
      reason: "guardian_name_matches_diver",
    });
    // **The refusal is still the default** (issue #1573). A namesake co-signer
    // with `namesakeAttested` left off — which is every form the staffer has
    // not ticked, and every request that never rendered the confirmation —
    // meets exactly the refusal it met before.
    expect(
      await attempt({
        name: ctx.person.fullName,
        relationship: "parent",
        namesakeAttested: false,
      }),
    ).toEqual({ ok: false, reason: "guardian_name_matches_diver" });
    expect(
      await attempt({ name: withMiddleInitial(ctx.person.fullName), relationship: "parent" }),
    ).toEqual({ ok: false, reason: "guardian_name_matches_diver" });
    // Nothing was written by either refusal: the row is the document.
    expect(
      await ctx.db.select().from(waiverRecords).where(eq(waiverRecords.bookingId, ctx.booking.id)),
    ).toEqual([]);

    const recorded = await attempt({ name: "Jonas Fischer", relationship: "legal_guardian" });
    if (!recorded.ok) throw new Error(`expected a record: ${recorded.reason}`);
    const [record] = await db_record(ctx, recorded.recordId);
    expect(record).toMatchObject({
      signatureMethod: "in_person_attested",
      guardianName: "Jonas Fischer",
      guardianRelationship: "legal_guardian",
      guardianSignatureMethod: "in_person_attested",
      // No address on a paper form; the diver's own contact is how the shop
      // reaches the family.
      guardianEmail: null,
    });
  });

  /**
   * **The notice's advice, made true** (issue 1539). The staff notice tells a
   * front desk that a spelled-out middle name clears the refusal and a single
   * initial does not, which is only worth saying if `personNamesMatch` behaves
   * that way: it compares tokens of two characters or more, so the initial is
   * dropped and changes nothing. The refusal above pins the initial; this pins
   * the other half, on its own booking because it records a real release.
   */
  it("clears the same refusal once the guardian's middle name is spelled out", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const [staff] = await listStaff(ctx.db, ctx.shop.id);
    if (!staff) throw new Error("demo staff missing");

    const recorded = await recordInPersonWaiver(ctx.db, {
      shopId: ctx.shop.id,
      subject: { bookingId: ctx.booking.id },
      recordedByPersonId: staff.person.id,
      medicalAttested: true,
      guardian: { name: withMiddleName(ctx.person.fullName), relationship: "parent" },
      now,
    });

    if (!recorded.ok) throw new Error(`expected a record: ${recorded.reason}`);
    const [record] = await db_record(ctx, recorded.recordId);
    expect(record).toMatchObject({ guardianName: withMiddleName(ctx.person.fullName) });
  });

  /**
   * **The one way past the namesake refusal, and the three fences around it**
   * (issue #1573, owner decision 2026-09-10; ADR 20260907-guardian-co-signature,
   * decision 10).
   *
   * A parent and child whose IDs read identically had no route to a recorded
   * release anywhere in the product. The paper path now has one, because there
   * a named staffer physically watched two people sign — and the assertion
   * lands on the record as its own signature method rather than disappearing
   * into an ordinary attestation.
   */
  it("records a namesake co-signature on the staffer's explicit attestation", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const [staff] = await listStaff(ctx.db, ctx.shop.id);
    if (!staff) throw new Error("demo staff missing");

    const recorded = await recordInPersonWaiver(ctx.db, {
      shopId: ctx.shop.id,
      subject: { bookingId: ctx.booking.id },
      recordedByPersonId: staff.person.id,
      medicalAttested: true,
      guardian: {
        name: ctx.person.fullName,
        relationship: "parent",
        namesakeAttested: true,
      },
      now,
    });

    if (!recorded.ok) throw new Error(`expected a record: ${recorded.reason}`);
    const [record] = await db_record(ctx, recorded.recordId);
    expect(record).toMatchObject({
      // The diver's own signature is an ordinary attestation; only the
      // guardian's half carries the distinction, because only it was refused.
      signatureMethod: "in_person_attested",
      guardianName: ctx.person.fullName,
      guardianRelationship: "parent",
      guardianSignatureMethod: "in_person_attested_namesake",
      guardianEmail: null,
    });
    // The staffer who made the assertion is on the row, which is what the
    // assertion is worth anything for.
    expect(record?.recordedByPersonId).toBe(staff.person.id);
    // Inside the seal: a distinction that could be edited off the row after
    // the fact would be no distinction at all.
    if (!record) throw new Error("expected a record row");
    expect(verifyWaiverIntegrity(record)).toBe("valid");

    // **Readiness does not branch on it.** A namesake record is a co-signed
    // record, so the minor boards — which is the entire point of the decision,
    // and the property a future refactor is most likely to break.
    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.booking.id);
    expect(readiness?.blockers ?? []).not.toContainEqual(
      expect.objectContaining({ code: "guardian_signature_missing" }),
    );
  });

  it("ignores the namesake attestation when the two names differ", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const [staff] = await listStaff(ctx.db, ctx.shop.id);
    if (!staff) throw new Error("demo staff missing");

    // A tick on a form whose names are plainly different asserts nothing, so
    // it records nothing: the method stays the ordinary one. Without this the
    // confirmation would become a habitual tick that quietly relabels every
    // paper co-signature.
    const recorded = await recordInPersonWaiver(ctx.db, {
      shopId: ctx.shop.id,
      subject: { bookingId: ctx.booking.id },
      recordedByPersonId: staff.person.id,
      medicalAttested: true,
      guardian: { name: "Jonas Fischer", relationship: "parent", namesakeAttested: true },
      now,
    });

    if (!recorded.ok) throw new Error(`expected a record: ${recorded.reason}`);
    const [record] = await db_record(ctx, recorded.recordId);
    expect(record).toMatchObject({
      guardianName: "Jonas Fischer",
      guardianSignatureMethod: "in_person_attested",
    });
  });

  /**
   * **Adversarial: the online path gains nothing.** The decision is explicit
   * that the browser-facing release keeps refusing a co-signer with the
   * diver's own name — online the shop has no evidence a second person exists
   * at all. `GuardianInput` carries no attestation field, so a hand-built
   * request cannot even name one; this pins that a stray property on the
   * submitted object changes nothing about the answer.
   */
  it("keeps refusing a namesake guardian on the online path, attestation or not", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const issued = await liveLink(ctx);

    expect(
      await completeWaiver(ctx.db, issued.token, {
        signerName: ctx.person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        // Spread through `unknown`: `namesakeAttested` is not part of
        // `GuardianInput` and the compiler is right to say so — a hand-built
        // request is not type-checked, which is exactly what this is standing
        // in for.
        guardian: {
          ...guardian,
          name: ctx.person.fullName,
          namesakeAttested: true,
        } as unknown as typeof guardian,
        now,
      }),
    ).toEqual({ ok: false, reason: "guardian_invalid" });

    // Nothing was written, and the link is still the one the family holds.
    expect(await getWaiverForToken(ctx.db, issued.token, now)).toMatchObject({
      state: "available",
    });
  });

  it("takes the guardian's name and address under erasure and keeps the signature's fact", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const issued = await liveLink(ctx);
    await completeWaiver(ctx.db, issued.token, {
      signerName: ctx.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      guardian,
      now,
    });
    const [staff] = await listStaff(ctx.db, ctx.shop.id);
    if (!staff) throw new Error("demo staff missing");

    const erased = await anonymizeDiver(ctx.db, {
      shopId: ctx.shop.id,
      personId: ctx.person.id,
      actorPersonId: staff.person.id,
    });
    expect(erased.ok).toBe(true);

    const [record] = await db_record(ctx, issued.recordId);
    // A third party's personal data goes with the diver's own...
    expect(record?.guardianName).toBeNull();
    expect(record?.guardianEmail).toBeNull();
    // ...and the fact that somebody co-signed, as what and when, survives —
    // exactly as the diver's own `signed_at` does.
    expect(record?.guardianRelationship).toBe("parent");
    expect(record?.guardianSignedAt).not.toBeNull();
    expect(record?.guardianSignatureMethod).toBe("typed_consent");
  });

  /** One release row by id, for the assertions above. */
  function db_record(ctx: Awaited<ReturnType<typeof waiverContext>>, recordId: string) {
    return ctx.db.select().from(waiverRecords).where(eq(waiverRecords.id, recordId));
  }
});

describe("a release on a held seat (issue #2125)", () => {
  // The bearer of a held seat's link may be somebody other than the matched
  // person, so no link is issued while the seat is held, and one issued
  // before stops opening, drafting or signing until the desk confirms.
  async function hold(db: Awaited<ReturnType<typeof waiverContext>>["db"], bookingId: string) {
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: now, identityBookedAs: "Tom Marsh" })
      .where(eq(bookings.id, bookingId));
  }
  const signature = (signerName: string) => ({
    signerName,
    agreed: true,
    medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    now,
  });

  it("issues no link while the seat is held", async () => {
    const { db, shop, booking } = await waiverContext();
    await hold(db, booking.id);
    expect(await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now })).toEqual({
      ok: false,
      reason: "identity_unconfirmed",
    });
  });

  it("holds a link issued earlier: no form, no draft, no signature", async () => {
    const { db, shop, booking, person } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    await hold(db, booking.id);

    expect((await getWaiverForToken(db, issued.token, now)).state).toBe("held");
    expect(
      await saveWaiverDraft(db, issued.token, {
        signerName: person.fullName,
        acknowledged: true,
        medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
        now,
      }),
    ).toBe(false);
    // Even signed under the matched person's own name.
    expect(await completeWaiver(db, issued.token, signature(person.fullName))).toEqual({
      ok: false,
      reason: "identity_unconfirmed",
    });

    // Confirmed, the same link signs.
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null, identityBookedAs: null })
      .where(eq(bookings.id, booking.id));
    expect(await completeWaiver(db, issued.token, signature(person.fullName))).toMatchObject({
      ok: true,
    });
  });
});
