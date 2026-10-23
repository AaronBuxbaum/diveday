import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { getTripManifest } from "./manifests";
import {
  medicalAlertForSeat,
  medicalAlertPrefill,
  medicalAlertTextsForTrip,
} from "./medical-alerts";
import { bookings, people, waiverRecords } from "./schema";
import { completeWaiver } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";
import { saveWaiverTemplate } from "./waivers-templates";
import { clearAnswers, now, waiverContextFor } from "./waivers-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test.
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

const alert = "Bee-sting allergy. EpiPen in the blue dry bag.";
let seq = 0;

/** The demo seat, signed with `medicalAlert`. */
async function signedWith(medicalAlert: string) {
  const context = await waiverContext();
  const { db, shop, booking, person } = context;
  const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
  if (!issued.ok) throw new Error("expected a waiver link");
  const signed = await completeWaiver(db, issued.token, {
    signerName: person.fullName,
    agreed: true,
    medicalAnswers: clearAnswers,
    medicalAlert,
    now,
  });
  if (!signed.ok) throw new Error(`expected a signature, got ${signed.reason}`);
  return context;
}

describe("the medical alert on the boat (issue #2960)", () => {
  it("flags the seat on the manifest, the fact only, and no other seat", async () => {
    const { db, shop, trip, booking } = await signedWith(alert);
    const manifest = await getTripManifest(db, shop.id, trip.id);
    if (!manifest) throw new Error("manifest missing");
    const row = manifest.divers.find((diver) => diver.bookingId === booking.id);
    expect(row?.medicalAlert).toBe(true);
    // The manifest every staffer opens never carries the words.
    expect(JSON.stringify(manifest)).not.toContain("EpiPen");
    for (const other of manifest.divers.filter((diver) => diver.bookingId !== booking.id)) {
      expect(other.medicalAlert, other.fullName).not.toBe(true);
    }
  });

  it("changes no count, readiness or roll-call fact on the manifest", async () => {
    const withAlert = await signedWith(alert);
    const flagged = await getTripManifest(withAlert.db, withAlert.shop.id, withAlert.trip.id);
    if (!flagged) throw new Error("manifest missing");
    // Lift the flag and compare everything else: the alert moved nothing.
    const strip = (manifest: typeof flagged) => ({
      ...manifest,
      divers: manifest.divers.map(({ medicalAlert: _alert, ...diver }) => diver),
    });
    await withAlert.db.update(waiverRecords).set({ medicalAlert: null });
    const unflagged = await getTripManifest(withAlert.db, withAlert.shop.id, withAlert.trip.id);
    if (!unflagged) throw new Error("manifest missing");
    expect(strip(flagged)).toEqual(strip(unflagged));
  });

  it("reads the text for an admitted reader, by seat and for the whole departure", async () => {
    const { db, shop, trip, booking, person } = await signedWith(alert);
    expect(await medicalAlertForSeat(db, shop.id, trip.id, booking.id)).toEqual({
      personId: person.id,
      text: alert,
    });
    const texts = await medicalAlertTextsForTrip(db, shop.id, trip.id);
    expect(texts.get(booking.id)).toBe(alert);
    expect([...texts.values()].every((text) => text.length > 0)).toBe(true);
  });

  it("answers nothing for a seat on another departure or of another shop", async () => {
    const { db, shop, trip, booking } = await signedWith(alert);
    expect(
      await medicalAlertForSeat(db, shop.id, "00000000-0000-4000-8000-000000000000", booking.id),
    ).toBeNull();
    expect(
      await medicalAlertForSeat(db, "00000000-0000-4000-8000-000000000000", trip.id, booking.id),
    ).toBeNull();
  });

  it("withholds the flag and the text on a held seat", async () => {
    const { db, shop, trip, booking } = await signedWith(alert);
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: now, identityBookedAs: "Someone Else" })
      .where(eq(bookings.id, booking.id));
    const manifest = await getTripManifest(db, shop.id, trip.id);
    expect(manifest?.divers.find((diver) => diver.bookingId === booking.id)?.medicalAlert).toBe(
      false,
    );
    expect(await medicalAlertForSeat(db, shop.id, trip.id, booking.id)).toBeNull();
    expect((await medicalAlertTextsForTrip(db, shop.id, trip.id)).has(booking.id)).toBe(false);
  });

  it("follows the standing release: signing again with nothing clears the flag", async () => {
    const { db, shop, trip, booking, person, template } = await signedWith(alert);
    await saveWaiverTemplate(db, {
      shopId: shop.id,
      body: `${template.body}\n\nNew terms.`,
      material: true,
    });
    const again = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!again.ok) throw new Error("expected a fresh link");
    await completeWaiver(db, again.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      medicalAlert: "",
      now,
    });
    const manifest = await getTripManifest(db, shop.id, trip.id);
    expect(manifest?.divers.find((diver) => diver.bookingId === booking.id)?.medicalAlert).toBe(
      false,
    );
    expect(await medicalAlertForSeat(db, shop.id, trip.id, booking.id)).toBeNull();
  });
});

/**
 * Domain reviews S3/S4, security review 2 L-1/L-2: a fresh link never carries
 * an earlier release's words (the link is a bearer capability that may not be
 * in the diver's hands). It says only that the person's latest signed release
 * here carried an alert, so the diver writes it again if it still applies.
 */
describe("medicalAlertPrefill", () => {
  /** A new release for the person, not yet signed: what the shop's next "Send waiver" opens. */
  async function pendingFor(db: AppDb, personId: string) {
    const [signed] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.personId, personId))
      .limit(1);
    if (!signed) throw new Error("signed record missing");
    seq += 1;
    const [record] = await db
      .insert(waiverRecords)
      .values({
        shopId: signed.shopId,
        bookingId: null,
        personId,
        templateId: signed.templateId,
        templateTitle: signed.templateTitle,
        templateVersion: signed.templateVersion,
        templateGeneration: signed.templateGeneration,
        templateBody: signed.templateBody,
        status: "pending",
        tokenHash: `prefill-${seq}-${signed.id}`,
        expiresAt: signed.expiresAt,
      })
      .returning();
    if (!record) throw new Error("fresh record missing");
    return record;
  }

  async function freshLinkAfterSigning(medicalAlert: string) {
    const context = await signedWith(medicalAlert);
    return { ...context, record: await pendingFor(context.db, context.person.id) };
  }

  it("says the latest signed release here carried an alert, and never carries its words", async () => {
    const { db, record } = await freshLinkAfterSigning(alert);
    expect(record.medicalAlert).toBeNull();
    const prefill = await medicalAlertPrefill(db, record);
    expect(prefill).toEqual({ draft: null, earlierAlert: true });
    expect(JSON.stringify(prefill)).not.toContain("EpiPen");
  });

  it("prefers the link's own draft, even a blank one the diver saved, and adds no note", async () => {
    const { db, record } = await freshLinkAfterSigning(alert);
    expect(
      await medicalAlertPrefill(db, { ...record, draftMedicalAlert: "Inhaler in my BCD pocket." }),
    ).toEqual({ draft: "Inhaler in my BCD pocket.", earlierAlert: false });
    // A saved draft with the box cleared stays cleared.
    expect(
      await medicalAlertPrefill(db, {
        ...record,
        draftMedicalAlert: null,
        draftMedicalAnswers: clearAnswers,
      }),
    ).toEqual({ draft: null, earlierAlert: false });
  });

  it("reads only the latest signed release: an alert the diver cleared on purpose stays cleared", async () => {
    const { db, shop, booking, person, template } = await signedWith(alert);
    await saveWaiverTemplate(db, {
      shopId: shop.id,
      body: `${template.body}\n\nNew terms.`,
      material: true,
    });
    const again = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!again.ok) throw new Error("expected a fresh link");
    const cleared = await completeWaiver(db, again.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      medicalAlert: "",
      now: new Date(now.getTime() + 60_000),
    });
    if (!cleared.ok) throw new Error(`expected a signature, got ${cleared.reason}`);
    const pending = await pendingFor(db, person.id);
    expect(await medicalAlertPrefill(db, pending)).toEqual({ draft: null, earlierAlert: false });
  });

  it("says nothing on a held seat's link (defense in depth: the page renders no form there)", async () => {
    const { db, booking, record } = await freshLinkAfterSigning(alert);
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: now })
      .where(eq(bookings.id, booking.id));
    expect(await medicalAlertPrefill(db, { ...record, bookingId: booking.id })).toEqual({
      draft: null,
      earlierAlert: false,
    });
  });

  it("reads the record's person at render, so a link moved to someone else says nothing", async () => {
    const { db, shop, record } = await freshLinkAfterSigning(alert);
    const [someoneElse] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Someone Else" })
      .returning({ id: people.id });
    if (!someoneElse) throw new Error("person insert failed");
    await db
      .update(waiverRecords)
      .set({ personId: someoneElse.id })
      .where(eq(waiverRecords.id, record.id));
    const [moved] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, record.id));
    if (!moved) throw new Error("moved record missing");
    expect(await medicalAlertPrefill(db, moved)).toEqual({ draft: null, earlierAlert: false });
  });
});
