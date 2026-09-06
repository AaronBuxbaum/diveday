import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { seededShopContext } from "@/test/db";
import { getRentalFit, saveRentalFit } from "./rental-fit";
import { certifications, people, waiverRecords } from "./schema";
import { deliverSelfRegistrationWaiver, registerDiverAtShop } from "./self-registration";
import { completeWaiver, getWaiverForToken, issueWaiverRequest } from "./waivers";

const now = new Date("2026-07-18T12:00:00.000Z");
const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
const referralAnswers = {
  ...clearAnswers,
  responses: { ...clearAnswers.responses, q3: true },
};

const walkIn = (overrides: Partial<Parameters<typeof registerDiverAtShop>[1]> = {}) => ({
  fullName: "Ines Oyelaran",
  email: `ines-${randomUUID()}@example.com`,
  now,
  ...overrides,
});

/**
 * **The counter's QR** (issue #1236).
 *
 * The property everything else here serves: a visitor learns nothing about
 * anyone. The write matches a returning diver by email — right, and the reason
 * this could have become a person-enumeration oracle — so the tests that matter
 * most are the ones proving the *outcome* is the same either way.
 */
describe("self-registration", () => {
  it("creates the person, marks where the record came from, and sends their release", async () => {
    const { db, shop } = await seededShopContext();
    const email = `ines-${randomUUID()}@example.com`;
    const { personId } = await registerDiverAtShop(db, { shopId: shop.id, ...walkIn({ email }) });
    // The action runs this in `after()`, off the request path — the send is
    // what a new diver and a returning one would otherwise be timed apart by.
    await deliverSelfRegistrationWaiver(db, { shopId: shop.id, personId, now });

    const [person] = await db.select().from(people).where(eq(people.id, personId));
    expect(person).toMatchObject({ fullName: "Ines Oyelaran", email, selfRegisteredAt: now });

    // The ordinary person-scoped release, on the ordinary path.
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.personId, personId), isNull(waiverRecords.bookingId)));
    expect(record).toMatchObject({ status: "pending", shopId: shop.id });
  });

  it("files the certification as the diver's own word, never as evidence", async () => {
    const { db, shop } = await seededShopContext();
    const { personId } = await registerDiverAtShop(db, {
      shopId: shop.id,
      ...walkIn(),
      certification: { agency: "padi", level: "advanced_open_water", identifier: "PADI-99887" },
    });
    const [card] = await db
      .select()
      .from(certifications)
      .where(eq(certifications.personId, personId));
    expect(card).toMatchObject({
      agency: "padi",
      level: "advanced_open_water",
      // The stamp `reviewCertification` reads before it will promote a row: a
      // number typed on a phone must never inherit the one-tap "Mark
      // certified" a colleague's transcription gets.
      selfDeclaredAt: now,
      status: "pending",
      // The number the diver typed goes to `declared_identifier`. `identifier`
      // is a *key*: a claim carrying one collides on the unique index, answers
      // "is this number on file here?" to anyone who watches, and — through
      // `heldForReview` — withdraws the card-entry form from the real diver.
      identifier: null,
      declaredIdentifier: "PADI-99887",
    });
  });

  it("keeps the sizes the diver gave, and claims nothing about what they rent", async () => {
    const { db, shop } = await seededShopContext();
    const { personId } = await registerDiverAtShop(db, {
      shopId: shop.id,
      ...walkIn(),
      fit: { wetsuitSize: "M", bootSize: "9", finSize: "L" },
    });
    const fit = await getRentalFit(db, shop.id, personId);
    expect(fit).toMatchObject({ wetsuitSize: "M", bootSize: "9", finSize: "L", rentsBcd: false });
  });

  it("reuses the person on a second submission, and never splits their history", async () => {
    const { db, shop } = await seededShopContext();
    const email = `ines-${randomUUID()}@example.com`;
    const first = await registerDiverAtShop(db, { shopId: shop.id, ...walkIn({ email }) });
    const second = await registerDiverAtShop(db, {
      shopId: shop.id,
      ...walkIn({ email, now: new Date(now.getTime() + 86_400_000) }),
    });
    expect(second.personId).toBe(first.personId);
    const rows = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, email)));
    expect(rows).toHaveLength(1);
  });

  it("leaves the original mark alone when a returning diver registers again", async () => {
    // The mark means "this record came from the diver", not "this diver was
    // here recently" — so a second visit must not rewrite it.
    const { db, shop } = await seededShopContext();
    const email = `ines-${randomUUID()}@example.com`;
    const { personId } = await registerDiverAtShop(db, { shopId: shop.id, ...walkIn({ email }) });
    await registerDiverAtShop(db, {
      shopId: shop.id,
      ...walkIn({ email, now: new Date(now.getTime() + 86_400_000) }),
    });
    const [person] = await db.select().from(people).where(eq(people.id, personId));
    expect(person.selfRegisteredAt).toEqual(now);
  });

  it("mints no second link for a diver whose release still stands — sign-once holds", async () => {
    const { db, shop } = await seededShopContext();
    const email = `ines-${randomUUID()}@example.com`;
    const { personId } = await registerDiverAtShop(db, { shopId: shop.id, ...walkIn({ email }) });
    await deliverSelfRegistrationWaiver(db, { shopId: shop.id, personId, now });

    // Sign the release the registration issued.
    const issued = await issueWaiverRequest(db, { shopId: shop.id, personId, now });
    const token = issued.ok
      ? issued.token
      : (() => {
          throw new Error("expected the registration's own pending link to be reusable");
        })();
    await completeWaiver(db, token, {
      signerName: "Ines Oyelaran",
      agreed: true,
      medicalAnswers: clearAnswers,
      now,
    });

    const again = new Date(now.getTime() + 3_600_000);
    await registerDiverAtShop(db, { shopId: shop.id, ...walkIn({ email, now: again }) });
    await deliverSelfRegistrationWaiver(db, { shopId: shop.id, personId, now: again });
    const records = await db
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.personId, personId), isNull(waiverRecords.bookingId)));
    // One record, completed. A second registration did not mint another.
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("completed");
  });

  it("registers a phone-only walk-in as their own record, matching nobody", async () => {
    const { db, shop } = await seededShopContext();
    const first = await registerDiverAtShop(db, {
      shopId: shop.id,
      fullName: "Phone Only",
      email: null,
      phone: "+13055550111",
      now,
    });
    const second = await registerDiverAtShop(db, {
      shopId: shop.id,
      fullName: "Phone Only",
      email: null,
      phone: "+13055550111",
      now,
    });
    // Two rows, honestly: there is nothing to match on, and inventing a
    // synthetic address to match by would put a fake, mailable-looking value
    // in front of the shop.
    expect(second.personId).not.toBe(first.personId);
    const [person] = await db.select().from(people).where(eq(people.id, first.personId));
    expect(person).toMatchObject({ email: null, phone: "+13055550111", selfRegisteredAt: now });
  });

  it("never reaches another shop's diver with a matching address", async () => {
    const { db, shop } = await seededShopContext();
    const email = `ines-${randomUUID()}@example.com`;
    const { personId } = await registerDiverAtShop(db, { shopId: shop.id, ...walkIn({ email }) });
    const [person] = await db.select().from(people).where(eq(people.id, personId));
    expect(person.shopId).toBe(shop.id);
  });

  it("still blocks a referred diver at the boat, and says nothing publicly", async () => {
    // The medical hard block is untouched by this door: the answers arrive
    // through the ordinary waiver flow, and the block is the shop's to see.
    // `registerDiverAtShop` returns the same shape whatever the answers were.
    const { db, shop } = await seededShopContext();
    const email = `ines-${randomUUID()}@example.com`;
    const { personId } = await registerDiverAtShop(db, { shopId: shop.id, ...walkIn({ email }) });
    await deliverSelfRegistrationWaiver(db, { shopId: shop.id, personId, now });
    const issued = await issueWaiverRequest(db, { shopId: shop.id, personId, now });
    if (!issued.ok) throw new Error("expected the registration's own pending link");
    await completeWaiver(db, issued.token, {
      signerName: "Ines Oyelaran",
      agreed: true,
      medicalAnswers: referralAnswers,
      now,
    });

    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.personId, personId), isNull(waiverRecords.bookingId)));
    expect(record.status).toBe("medical_review");
    // And the token still resolves for the diver themselves, so nothing about
    // the block reaches them as a refusal.
    expect(await getWaiverForToken(db, issued.token, now)).not.toEqual({ state: "unavailable" });
  });

  it("survives a shop with no waiver template rather than losing the diver", async () => {
    // The person is the thing that had to land: a shop mid-setup with no
    // release yet still gets the walk-in on file.
    const { db, shop } = await seededShopContext();
    await db.delete(waiverRecords).where(eq(waiverRecords.shopId, shop.id));
    const { personId } = await registerDiverAtShop(db, { shopId: shop.id, ...walkIn() });
    await deliverSelfRegistrationWaiver(db, { shopId: shop.id, personId, now });
    const [person] = await db.select().from(people).where(eq(people.id, personId));
    expect(person).toBeTruthy();
  });

  /**
   * **Matching a returning diver is what makes this form dangerous.** Anyone
   * holding a diver's email address can submit as them, so every write that
   * runs on a *matched* person is a write a stranger controls. These are the
   * two the shop would otherwise find out about at the dock
   * (`security-reviewer`, #1236).
   */
  describe("a person the shop already knows", () => {
    it("never overwrites the fit a returning diver already has", async () => {
      const { db, shop } = await seededShopContext();
      const email = `ines-${randomUUID()}@example.com`;
      const { personId } = await registerDiverAtShop(db, { shopId: shop.id, ...walkIn({ email }) });
      // What the shop and the diver settled on together: sizes, and the gear
      // the boat packs for them.
      await saveRentalFit(db, {
        shopId: shop.id,
        personId,
        rentsBcd: true,
        rentsRegulator: true,
        rentsWetsuit: true,
        rentsMaskFins: false,
        rentsWeights: true,
        rentsDiveComputer: false,
        rentsGopro: false,
        rentsDrysuit: false,
        rentsHoodGloves: false,
        rentsTorch: false,
        rentsSmb: false,
        wetsuitSize: "L",
        bootSize: "11",
        finSize: "XL",
      });

      await registerDiverAtShop(db, {
        shopId: shop.id,
        ...walkIn({ email, now: new Date(now.getTime() + 86_400_000) }),
        fit: { wetsuitSize: "XS", bootSize: "5", finSize: "S" },
      });

      // Unchanged — flags included. `saveRentalFit` upserts all seven, so a
      // matched write here would drop this diver's BCD, regulator, wetsuit and
      // weights off the packing list and they would find out at the dock.
      const fit = await getRentalFit(db, shop.id, personId);
      expect(fit).toMatchObject({
        wetsuitSize: "L",
        bootSize: "11",
        finSize: "XL",
        rentsBcd: true,
        rentsRegulator: true,
        rentsWetsuit: true,
        rentsWeights: true,
      });
    });

    it("never displaces the card the shop verified with a claim typed on a phone", async () => {
      const { db, shop } = await seededShopContext();
      const email = `ines-${randomUUID()}@example.com`;
      const { personId } = await registerDiverAtShop(db, { shopId: shop.id, ...walkIn({ email }) });
      // The card a staffer sighted, off the physical plastic.
      await db.insert(certifications).values({
        shopId: shop.id,
        personId,
        agency: "padi",
        level: "open_water",
        identifier: "PADI-11111",
        status: "verified",
      });

      await registerDiverAtShop(db, {
        shopId: shop.id,
        ...walkIn({ email, now: new Date(now.getTime() + 86_400_000) }),
        certification: { agency: "padi", level: "instructor", identifier: "PADI-99999" },
      });

      const cards = await db
        .select()
        .from(certifications)
        .where(eq(certifications.personId, personId));
      // Nothing was written at all. `decideTripAdmission` reads these rows, so
      // a stranger's "Instructor" claim landing beside a card the shop believes
      // it checked would move the booking gate on somebody else's typing.
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        level: "open_water",
        identifier: "PADI-11111",
        status: "verified",
      });
    });
  });
});
