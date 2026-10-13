import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyMedicalAnswers, findQuestionnaireVersion, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import { bookings, people, shops } from "./schema";
import { listSignedWaiversByPerson } from "./waivers-audit";
import {
  completeWaiver,
  getEmergencyContactForBearer,
  getWaiverForToken,
  saveBookingEmergencyContact,
  saveWaiverDraft,
} from "./waivers-completion";
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

    await expect(getEmergencyContactForBearer(db, shop.id, booking.id)).resolves.toMatchObject({
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
    await expect(getEmergencyContactForBearer(db, shop.id, booking.id)).resolves.toMatchObject({
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

    await expect(getEmergencyContactForBearer(db, shop.id, booking.id)).resolves.toMatchObject({
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
    await expect(getEmergencyContactForBearer(db, shop.id, booking.id)).resolves.toMatchObject({
      name: "Alex Rivera",
      phone: "+1 305 555 0133",
    });
  });

  it("refuses to write when the booking belongs to a different shop", async () => {
    const { db, shop, booking } = await waiverContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-emergency-contact-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    // The seeded demo diver may already carry a contact — capture whatever it
    // actually is rather than assume null, so this asserts nothing changed,
    // not a specific starting value.
    const before = await getEmergencyContactForBearer(db, shop.id, booking.id);

    const saved = await saveBookingEmergencyContact(db, {
      shopId: otherShop.id,
      bookingId: booking.id,
      name: "Should Not Land",
      phone: "+1 000 000 0000",
      actor: "staff",
    });
    expect(saved).toBe(false);
    await expect(getEmergencyContactForBearer(db, shop.id, booking.id)).resolves.toEqual(before);
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
    await expect(getEmergencyContactForBearer(db, shop.id, booking.id)).resolves.toMatchObject({
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
    await expect(getEmergencyContactForBearer(db, shop.id, booking.id)).resolves.toMatchObject({
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
    await expect(getEmergencyContactForBearer(db, shop.id, booking.id)).resolves.toMatchObject({
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
    const { db, shop, booking } = await heldSeat();
    await expect(getEmergencyContactForBearer(db, shop.id, booking.id)).resolves.toMatchObject({
      name: null,
      phone: null,
      held: true,
    });
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null })
      .where(eq(bookings.id, booking.id));
    await expect(getEmergencyContactForBearer(db, shop.id, booking.id)).resolves.toMatchObject({
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
