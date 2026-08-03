import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { prepareContactImport } from "@/lib/import";
import { isCompletedWaiverCurrent } from "@/lib/waivers";
import { seededShopContext } from "@/test/db";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { canPersonImportShopData, commitContactImport } from "./import";
import {
  bookings,
  certifications,
  nitroxCertifications,
  orders,
  people,
  personRoles,
  priorVisits,
  rentalFitProfiles,
  rollCallEvents,
  shops,
  specialtyCertifications,
  trips,
  userAccounts,
  waiverRecords,
  waiverTemplates,
} from "./schema";

async function personByEmail(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
  email: string,
) {
  const [row] = await db
    .select()
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.email, email), isNull(people.deletedAt)))
    .limit(1);
  return row ?? null;
}

async function accountPersonId(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  email: string,
) {
  const [account] = await db
    .select({ personId: userAccounts.personId })
    .from(userAccounts)
    .where(eq(userAccounts.email, email))
    .limit(1);
  if (!account) throw new Error(`no account for ${email}`);
  return account.personId;
}

describe("commitContactImport", () => {
  it("creates divers with a diver role, a verified-and-flagged imported card, and a rental fit", async () => {
    const { db, shop } = await seededShopContext();
    const csv = [
      "full_name,email,phone,certification_agency,certification_level,certification_number,prior_shop,wetsuit_size,fin_size",
      "Nadia Okonkwo,nadia.import@example.com,+1 305 555 0140,PADI,Advanced Open Water,AOW-778,Blue Horizon Divers,3mm/M,L",
    ].join("\n");
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const summary = await commitContactImport(db, shop.id, prepareContactImport(csv), importer);
    expect(summary).toMatchObject({ peopleCreated: 1, peopleUpdated: 0, cardsAdded: 1 });

    const person = await personByEmail(db, shop.id, "nadia.import@example.com");
    expect(person).toMatchObject({ fullName: "Nadia Okonkwo", phone: "+1 305 555 0140" });
    if (!person) throw new Error("person not created");

    const roles = await db
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, person.id));
    expect(roles.map((r) => r.role)).toEqual(["diver"]);

    const [card] = await db
      .select()
      .from(certifications)
      .where(eq(certifications.personId, person.id));
    // Imported cards land verified (the prior system checked them), flagged
    // imported with the prior-shop label, and reviewedAt null so the diver UI
    // surfaces a one-tap confirm. This is the line (ADR 20260724-import-verified-cards).
    expect(card).toMatchObject({
      level: "advanced_open_water",
      agency: "padi",
      status: "verified",
      importedFromLabel: "Blue Horizon Divers",
      reviewedAt: null,
    });
    expect(card.importedAt).toBeInstanceOf(Date);

    const [profile] = await db
      .select()
      .from(rentalFitProfiles)
      .where(eq(rentalFitProfiles.personId, person.id));
    expect(profile).toMatchObject({ wetsuitSize: "3mm/M", finSize: "L" });
  });

  it("matches an existing diver by email — updating, not duplicating — and leaves a card on file alone", async () => {
    const { db, shop } = await seededShopContext();
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const first = "full_name,email,phone\nRepeat Rita,rita.import@example.com,111";
    await commitContactImport(db, shop.id, prepareContactImport(first), importer);

    const second = [
      "full_name,email,phone,certification_agency,certification_level,certification_number",
      "Repeat Rita,RITA.IMPORT@example.com,222,SSI,Open Water,OW-555",
    ].join("\n");
    const summary = await commitContactImport(db, shop.id, prepareContactImport(second), importer);
    expect(summary).toMatchObject({ peopleCreated: 0, peopleUpdated: 1, cardsAdded: 1 });

    // One person, phone updated in place.
    const [person] = await db
      .select()
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, "rita.import@example.com")));
    expect(person).toMatchObject({ phone: "222" });

    // Re-importing the same card number does not touch it a second time.
    const again = await commitContactImport(db, shop.id, prepareContactImport(second), importer);
    expect(again).toMatchObject({ cardsAdded: 0, cardsSkippedExisting: 1, peopleUpdated: 1 });
  });

  it("merges rental sizes without wiping ones the import doesn't carry", async () => {
    const { db, shop } = await seededShopContext();
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    await commitContactImport(
      db,
      shop.id,
      prepareContactImport(
        "full_name,email,wetsuit_size,fin_size\nSize Sam,sam.import@example.com,3mm/M,L",
      ),
      importer,
    );
    // A second file carrying only a BCD size must not erase the wetsuit/fin on file.
    await commitContactImport(
      db,
      shop.id,
      prepareContactImport("full_name,email,bcd_size\nSize Sam,sam.import@example.com,M"),
      importer,
    );

    const person = await personByEmail(db, shop.id, "sam.import@example.com");
    if (!person) throw new Error("person not created");
    const [profile] = await db
      .select()
      .from(rentalFitProfiles)
      .where(eq(rentalFitProfiles.personId, person.id));
    expect(profile).toMatchObject({ bcdSize: "M", wetsuitSize: "3mm/M", finSize: "L" });
  });

  it("imports a nitrox card as verified-and-flagged, surfaced for a confirm", async () => {
    const { db, shop } = await seededShopContext();
    const csv = [
      "full_name,email,nitrox_certified,nitrox_certification_number",
      "Enzo Nitrox,enzo.import@example.com,yes,NX-9001",
    ].join("\n");
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const summary = await commitContactImport(db, shop.id, prepareContactImport(csv), importer);
    expect(summary.nitroxAdded).toBe(1);

    const person = await personByEmail(db, shop.id, "enzo.import@example.com");
    if (!person) throw new Error("person not created");
    const [card] = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.personId, person.id));
    // Verified on import (fills are re-checked at fill time), flagged imported,
    // reviewedAt null so it surfaces the one-tap confirm.
    expect(card).toMatchObject({ identifier: "NX-9001", status: "verified", reviewedAt: null });
    expect(card.importedAt).toBeInstanceOf(Date);
  });

  it("imports a specialty card verified-and-flagged, with its gate held for a confirm", async () => {
    const { db, shop } = await seededShopContext();
    const csv = [
      "full_name,email,certification_agency,specialty,specialty_certification_number,prior_shop",
      "Dana Deep,dana.import@example.com,PADI,Deep Diver,DP-4242,Blue Horizon Divers",
    ].join("\n");
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const summary = await commitContactImport(db, shop.id, prepareContactImport(csv), importer);
    expect(summary.specialtyAdded).toBe(1);

    const person = await personByEmail(db, shop.id, "dana.import@example.com");
    if (!person) throw new Error("person not created");
    const [card] = await db
      .select()
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.personId, person.id));
    // Verified because the prior system checked it, flagged imported, and
    // reviewedAt null — which is exactly what `specialtyBlocker` holds the deep
    // gate on until a staffer taps confirm (ADR 20260725-import-specialty-cards).
    expect(card).toMatchObject({
      specialty: "deep",
      agency: "padi",
      identifier: "DP-4242",
      status: "verified",
      importedFromLabel: "Blue Horizon Divers",
      reviewedAt: null,
    });
    expect(card.importedAt).toBeInstanceOf(Date);

    // The same card on a second run is left alone, on this same diver.
    const again = await commitContactImport(db, shop.id, prepareContactImport(csv), importer);
    expect(again).toMatchObject({ specialtyAdded: 0, specialtySkippedExisting: 1 });
    expect(again.cardsHeldByAnotherDiver).toBe(0);
  });

  it("gives one diver every specialty their agency number carries", async () => {
    // A PADI number identifies the diver, so Deep and Wreck share it. Before the
    // table was keyed on the specialty, the second card was silently dropped.
    const { db, shop } = await seededShopContext();
    const csv = [
      "full_name,email,certification_agency,specialty,specialty_certification_number",
      "Multi Molly,molly.import@example.com,PADI,Deep & Wreck,PADI-5150",
    ].join("\n");
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const summary = await commitContactImport(db, shop.id, prepareContactImport(csv), importer);
    expect(summary.specialtyAdded).toBe(2);

    const person = await personByEmail(db, shop.id, "molly.import@example.com");
    if (!person) throw new Error("person not created");
    const cards = await db
      .select()
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.personId, person.id));
    expect(cards.map((c) => c.specialty).sort()).toEqual(["deep", "wreck"]);
    expect(cards.every((c) => c.identifier === "PADI-5150")).toBe(true);
  });

  it("brings in every card of a one-row-per-card certification file", async () => {
    // The file the switching guides tell a shop to export: one row per card, so
    // the same diver's email repeats. Those rows must add cards, not be
    // discarded as duplicate people (`dive-domain-expert` review).
    const { db, shop } = await seededShopContext();
    const csv = [
      "full_name,email,certification_agency,certification_level,certification_number",
      "Cert Cass,cass.import@example.com,PADI,Advanced Open Water,PADI-777",
      "Cert Cass,cass.import@example.com,PADI,Deep Diver,PADI-777",
      "Cert Cass,cass.import@example.com,PADI,Night Diver,PADI-777",
    ].join("\n");
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const summary = await commitContactImport(db, shop.id, prepareContactImport(csv), importer);
    expect(summary).toMatchObject({
      peopleCreated: 1,
      rowsMerged: 2,
      cardsAdded: 1,
      specialtyAdded: 2,
      rowsSkipped: 0,
    });

    // One diver, three cards, no duplicate person.
    const person = await personByEmail(db, shop.id, "cass.import@example.com");
    if (!person) throw new Error("person not created");
    const specialties = await db
      .select()
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.personId, person.id));
    expect(specialties.map((c) => c.specialty).sort()).toEqual(["deep", "night"]);
    const levels = await db
      .select()
      .from(certifications)
      .where(eq(certifications.personId, person.id));
    expect(levels).toHaveLength(1);
  });

  it("reports a card number held by a different diver as exactly that, and writes nothing", async () => {
    const { db, shop } = await seededShopContext();
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    await commitContactImport(
      db,
      shop.id,
      prepareContactImport(
        "full_name,email,certification_level,certification_number\nFirst Holder,first.import@example.com,Open Water,SHARED-1",
      ),
      importer,
    );
    // A second diver carrying the same number: the unique index forbids the
    // card, and calling that "already on file" would tell the owner this diver
    // is carded when they are not (`security-reviewer` finding).
    const summary = await commitContactImport(
      db,
      shop.id,
      prepareContactImport(
        "full_name,email,certification_level,certification_number\nSecond Holder,second.import@example.com,Open Water,SHARED-1",
      ),
      importer,
    );
    expect(summary).toMatchObject({
      peopleCreated: 1,
      cardsAdded: 0,
      cardsSkippedExisting: 0,
      cardsHeldByAnotherDiver: 1,
    });
    const second = await personByEmail(db, shop.id, "second.import@example.com");
    if (!second) throw new Error("second person not created");
    expect(
      await db.select().from(certifications).where(eq(certifications.personId, second.id)),
    ).toHaveLength(0);
  });

  it("never sees another shop's divers or card numbers", async () => {
    const { db, shop } = await seededShopContext();
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-reef-import", timezone: "America/New_York" })
      .returning();
    const [rivalDiver] = await db
      .insert(people)
      .values({ shopId: rival.id, fullName: "Rival Rae", email: "shared.import@example.com" })
      .returning();
    await db.insert(specialtyCertifications).values({
      shopId: rival.id,
      personId: rivalDiver.id,
      agency: "padi",
      specialty: "deep",
      identifier: "RIVAL-1",
      status: "verified",
    });

    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const summary = await commitContactImport(
      db,
      shop.id,
      prepareContactImport(
        "full_name,email,certification_agency,specialty,specialty_certification_number\nShared Email,shared.import@example.com,PADI,Deep Diver,RIVAL-1",
      ),
      importer,
    );
    // The rival's identical email did not match, and its identical card number
    // did not block: both are scoped to their own shop.
    expect(summary).toMatchObject({ peopleCreated: 1, specialtyAdded: 1 });
    const ours = await personByEmail(db, shop.id, "shared.import@example.com");
    expect(ours?.id).not.toBe(rivalDiver.id);
    const rivalCards = await db
      .select()
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.personId, rivalDiver.id));
    expect(rivalCards).toHaveLength(1);
  });

  it("imports a card pending when the file says the prior system never verified it", async () => {
    const { db, shop } = await seededShopContext();
    const csv = [
      "full_name,email,certification_level,certification_number,cert_status",
      "Unverified Uma,uma.import@example.com,Open Water,OW-4004,unverified",
    ].join("\n");
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    await commitContactImport(db, shop.id, prepareContactImport(csv), importer);
    const person = await personByEmail(db, shop.id, "uma.import@example.com");
    if (!person) throw new Error("person not created");
    const [card] = await db
      .select()
      .from(certifications)
      .where(eq(certifications.personId, person.id));
    // Pending, but still flagged imported: provenance is a fact either way.
    expect(card).toMatchObject({ status: "pending", identifier: "OW-4004" });
    expect(card.importedAt).toBeInstanceOf(Date);
  });

  it("writes nothing for skipped rows and reports the count", async () => {
    const { db, shop } = await seededShopContext();
    const csv = [
      "full_name,email",
      ",nameless.import@example.com",
      "Real Person,real.import@example.com",
    ].join("\n");
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const summary = await commitContactImport(db, shop.id, prepareContactImport(csv), importer);
    expect(summary).toMatchObject({ peopleCreated: 1, rowsSkipped: 1 });
    expect(await personByEmail(db, shop.id, "nameless.import@example.com")).toBeNull();
  });
});

describe("commitContactImport — imported waiver acceptance (ADR 20260724-import-waiver-acceptance)", () => {
  it("trusts a row's accepted waiver, marks it imported, and stamps the actual acceptance date", async () => {
    const { db, shop } = await seededShopContext();
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const csv = [
      "full_name,email,waiver_accepted,waiver_signed_at,waiver_source_name",
      "Ines Import,ines.import@example.com,yes,2025-03-01,Old Blue Reef Divers",
    ].join("\n");
    const summary = await commitContactImport(db, shop.id, prepareContactImport(csv), importer);
    expect(summary).toMatchObject({ waiversAdded: 1, waiversSkippedExisting: 0 });

    const person = await personByEmail(db, shop.id, "ines.import@example.com");
    if (!person) throw new Error("person not created");
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.personId, person.id));
    expect(record).toMatchObject({
      bookingId: null,
      status: "completed",
      signatureMethod: "imported",
      signedName: "Ines Import",
      recordedByPersonId: importer,
      medicalReviewRequired: false,
      medicalAnswers: null,
      importedFromLabel: "Old Blue Reef Divers",
    });
    expect(record?.signedAt?.toISOString().slice(0, 10)).toBe("2025-03-01");

    // A year-old import correctly reads as current the day after acceptance,
    // and correctly reads as stale once the 365-day validity window passes —
    // real dates, not the import date, drive the clock.
    if (!record) throw new Error("record not created");
    expect(isCompletedWaiverCurrent(record, 1, new Date("2025-03-02T00:00:00Z"))).toBe(true);
    expect(isCompletedWaiverCurrent(record, 1, new Date("2026-04-01T00:00:00Z"))).toBe(false);
    // Never signed against any version of this shop's own template — the
    // version check is exempt for an imported record precisely so it isn't
    // wrongly read as stale for that reason alone.
    expect(isCompletedWaiverCurrent(record, 999, new Date("2025-03-02T00:00:00Z"))).toBe(true);
  });

  it("falls back to the import date when the row gives no parseable acceptance date", async () => {
    const { db, shop } = await seededShopContext();
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const csv = [
      "full_name,email,waiver_accepted,waiver_signed_at",
      "No Date Dana,dana.import@example.com,yes,not-a-date",
    ].join("\n");
    const prepared = prepareContactImport(csv);
    expect(prepared.rows[0]?.issues.some((i) => i.code === "waiver_date_invalid")).toBe(true);
    await commitContactImport(db, shop.id, prepared, importer);
    const person = await personByEmail(db, shop.id, "dana.import@example.com");
    if (!person) throw new Error("person not created");
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.personId, person.id));
    expect(record?.signedAt).not.toBeNull();
  });

  it("never disturbs a diver who already has current signed evidence on file", async () => {
    const { db, shop } = await seededShopContext();
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    // No waiver_signed_at: the commit stamps import time, which is always
    // current — the point of this test is the dedup, not the date math.
    const csv = ["full_name,email,waiver_accepted", "Twice Tina,tina.import@example.com,yes"].join(
      "\n",
    );
    const prepared = prepareContactImport(csv);
    const first = await commitContactImport(db, shop.id, prepared, importer);
    expect(first.waiversAdded).toBe(1);

    // Re-importing the same file must not create a second record.
    const second = await commitContactImport(db, shop.id, prepareContactImport(csv), importer);
    expect(second).toMatchObject({ waiversAdded: 0, waiversSkippedExisting: 1 });

    const person = await personByEmail(db, shop.id, "tina.import@example.com");
    if (!person) throw new Error("person not created");
    const records = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.personId, person.id));
    expect(records).toHaveLength(1);
  });

  it("fills the gap when the diver's only existing evidence is stale, rather than trusting a mere row's existence", async () => {
    const { db, shop } = await seededShopContext();
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const staleCsv = [
      "full_name,email,waiver_accepted,waiver_signed_at",
      "Stale Stan,stan.import@example.com,yes,2020-01-01",
    ].join("\n");
    const first = await commitContactImport(db, shop.id, prepareContactImport(staleCsv), importer);
    expect(first.waiversAdded).toBe(1);

    // A second, genuinely fresher claim must not be dropped just because a
    // (now stale, non-current) record already exists — the diver still needs
    // a fresh signature per the shop's own currency rule, and this row
    // supplies one.
    const freshCsv = [
      "full_name,email,waiver_accepted,waiver_signed_at",
      "Stale Stan,stan.import@example.com,yes,2026-06-01",
    ].join("\n");
    const second = await commitContactImport(db, shop.id, prepareContactImport(freshCsv), importer);
    expect(second).toMatchObject({ waiversAdded: 1, waiversSkippedExisting: 0 });

    const person = await personByEmail(db, shop.id, "stan.import@example.com");
    if (!person) throw new Error("person not created");
    const records = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.personId, person.id));
    expect(records).toHaveLength(2);
  });

  it("never lets an import override a live medical-review hold, however the row is dated", async () => {
    const { db, shop } = await seededShopContext();
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    // Seed a real diver with a live, unresolved medical_review hold, the way
    // the diver-facing waiver flow creates one — never faked as an import.
    const csv = "full_name,email\nHeld Hana,hana.import@example.com";
    await commitContactImport(db, shop.id, prepareContactImport(csv), importer);
    const person = await personByEmail(db, shop.id, "hana.import@example.com");
    if (!person) throw new Error("person not created");
    const [template] = await db
      .select()
      .from(waiverTemplates)
      .where(eq(waiverTemplates.shopId, shop.id));
    if (!template) throw new Error("no template");
    await db.insert(waiverRecords).values({
      shopId: shop.id,
      bookingId: null,
      personId: person.id,
      templateId: template.id,
      templateTitle: template.title,
      templateVersion: template.version,
      templateBody: template.body,
      status: "medical_review",
      tokenHash: `hold-${person.id}`,
      expiresAt: nowDate(),
      signedName: "Held Hana",
      signatureMethod: "typed_consent",
      consentedAt: nowDate(),
      signedAt: nowDate(),
      medicalReviewRequired: true,
      completedAt: nowDate(),
    });

    // A row claiming acceptance, dated *after* the hold, must still be
    // refused — a live referral block is never something an import can
    // silently out-date.
    const importCsv = [
      "full_name,email,waiver_accepted,waiver_signed_at",
      "Held Hana,hana.import@example.com,yes,2026-07-01",
    ].join("\n");
    const summary = await commitContactImport(
      db,
      shop.id,
      prepareContactImport(importCsv),
      importer,
    );
    expect(summary).toMatchObject({ waiversAdded: 0, waiversSkippedExisting: 1 });

    const records = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.personId, person.id));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "medical_review" });
  });

  it("skips a waiver claim (without failing the whole row) when the shop has no waiver template", async () => {
    const { db, shop } = await seededShopContext();
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    await db
      .update(waiverTemplates)
      .set({ archivedAt: nowDate() })
      .where(eq(waiverTemplates.shopId, shop.id));

    const csv = [
      "full_name,email,waiver_accepted",
      "No Template Nia,nia.import@example.com,yes",
    ].join("\n");
    const summary = await commitContactImport(db, shop.id, prepareContactImport(csv), importer);
    expect(summary).toMatchObject({
      peopleCreated: 1,
      waiversAdded: 0,
      waiversSkippedNoTemplate: 1,
    });
    const person = await personByEmail(db, shop.id, "nia.import@example.com");
    expect(person).not.toBeNull();
  });

  it("drops a waiver document link that resolves to a blocked/private address, without failing the import", async () => {
    const { db, shop } = await seededShopContext();
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const csv = [
      "full_name,email,waiver_accepted,waiver_document_url",
      "Blocked Bo,bo.import@example.com,yes,http://127.0.0.1/waiver.jpg",
    ].join("\n");
    const summary = await commitContactImport(db, shop.id, prepareContactImport(csv), importer);
    expect(summary).toMatchObject({ waiversAdded: 1, waiverDocumentsFailed: 1 });

    const person = await personByEmail(db, shop.id, "bo.import@example.com");
    if (!person) throw new Error("person not created");
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.personId, person.id));
    expect(record?.importSourceDocumentUrl).toBeNull();
  });
});

describe("commitContactImport — prior visits (ADR 20260725-import-prior-visits)", () => {
  const bookingsExport = [
    "customer_name,email,booking_date,tour_name,booking_status,total,booking_id,prior_shop",
    "Ines Vela,ines.visits@example.com,2024-05-11,Two-tank Molasses Reef,Completed,$165.00,CCD-1,Coral Coast Divers",
    "Ines Vela,ines.visits@example.com,2025-02-02,Night dive Benwood,Cancelled,$95.00,CCD-2,Coral Coast Divers",
  ].join("\n");

  async function visitsFor(
    db: Awaited<ReturnType<typeof seededShopContext>>["db"],
    shopId: string,
    email: string,
  ) {
    const person = await personByEmail(db, shopId, email);
    if (!person) throw new Error(`no person for ${email}`);
    return db
      .select()
      .from(priorVisits)
      .where(and(eq(priorVisits.shopId, shopId), eq(priorVisits.personId, person.id)))
      .orderBy(priorVisits.visitedOn);
  }

  it("writes one inert history row per booking, verbatim", async () => {
    const { db, shop } = await seededShopContext();
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const summary = await commitContactImport(
      db,
      shop.id,
      prepareContactImport(bookingsExport),
      importer,
    );
    expect(summary).toMatchObject({ peopleCreated: 1, rowsMerged: 1, visitsAdded: 2 });

    const visits = await visitsFor(db, shop.id, "ines.visits@example.com");
    expect(visits).toHaveLength(2);
    expect(visits[0]).toMatchObject({
      visitedOn: "2024-05-11",
      title: "Two-tank Molasses Reef",
      statusLabel: "Completed",
      amountLabel: "$165.00",
      sourceLabel: "Coral Coast Divers",
      sourceReference: "CCD-1",
    });
    // The prior system's own word, not a DiveDay booking status.
    expect(visits[1].statusLabel).toBe("Cancelled");
    expect(visits[0].importedAt).toBeInstanceOf(Date);
  });

  it("touches no operational table — the migration can never reach the dock", async () => {
    const { db, shop } = await seededShopContext();
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const before = {
      trips: (await db.select().from(trips).where(eq(trips.shopId, shop.id))).length,
      bookings: (await db.select().from(bookings).where(eq(bookings.shopId, shop.id))).length,
      rollCall: (await db.select().from(rollCallEvents).where(eq(rollCallEvents.shopId, shop.id)))
        .length,
      orders: (await db.select().from(orders).where(eq(orders.shopId, shop.id))).length,
    };
    await commitContactImport(db, shop.id, prepareContactImport(bookingsExport), importer);
    expect({
      trips: (await db.select().from(trips).where(eq(trips.shopId, shop.id))).length,
      bookings: (await db.select().from(bookings).where(eq(bookings.shopId, shop.id))).length,
      rollCall: (await db.select().from(rollCallEvents).where(eq(rollCallEvents.shopId, shop.id)))
        .length,
      orders: (await db.select().from(orders).where(eq(orders.shopId, shop.id))).length,
    }).toEqual(before);
  });

  it("does not double a diver's history when the same export is re-imported", async () => {
    const { db, shop } = await seededShopContext();
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    await commitContactImport(db, shop.id, prepareContactImport(bookingsExport), importer);
    const again = await commitContactImport(
      db,
      shop.id,
      prepareContactImport(bookingsExport),
      importer,
    );
    expect(again).toMatchObject({ visitsAdded: 0, visitsSkippedExisting: 2 });
    expect(await visitsFor(db, shop.id, "ines.visits@example.com")).toHaveLength(2);
  });

  it("still de-duplicates when the export carries no booking reference", async () => {
    const { db, shop } = await seededShopContext();
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const csv = [
      "customer_name,email,booking_date,tour_name,total",
      "Nora Ref,nora.noref@example.com,2024-05-11,Two-tank,$165.00",
    ].join("\n");
    await commitContactImport(db, shop.id, prepareContactImport(csv), importer);
    const again = await commitContactImport(db, shop.id, prepareContactImport(csv), importer);
    expect(again).toMatchObject({ visitsAdded: 0, visitsSkippedExisting: 1 });
    expect(await visitsFor(db, shop.id, "nora.noref@example.com")).toHaveLength(1);
  });

  it("keeps two same-day bookings apart when the export distinguishes them", async () => {
    const { db, shop } = await seededShopContext();
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const csv = [
      "customer_name,email,booking_date,tour_name,booking_id",
      "Dana Twice,dana.twice@example.com,2024-05-11,Morning two-tank,CCD-10",
      "Dana Twice,dana.twice@example.com,2024-05-11,Afternoon single,CCD-11",
    ].join("\n");
    const summary = await commitContactImport(db, shop.id, prepareContactImport(csv), importer);
    expect(summary.visitsAdded).toBe(2);
    expect(await visitsFor(db, shop.id, "dana.twice@example.com")).toHaveLength(2);
  });

  it("scopes visits to the importing shop", async () => {
    const { db, shop } = await seededShopContext();
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    await commitContactImport(db, shop.id, prepareContactImport(bookingsExport), importer);
    const [other] = await db
      .select()
      .from(shops)
      .where(eq(shops.slug, "blue-mantis"))
      .limit(1)
      .then((rows) => (rows[0]?.id === shop.id ? [] : rows));
    const strayShopId = other?.id ?? "00000000-0000-0000-0000-000000000000";
    const stray = await db.select().from(priorVisits).where(eq(priorVisits.shopId, strayShopId));
    expect(stray).toHaveLength(0);
  });
});

describe("import privilege re-check (database, not JWT)", () => {
  it("passes a current owner, refuses a captain, a disabled account, and a bad shop", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    expect(await canPersonImportShopData(db, shop.id, owner)).toBe(true);

    const captain = await accountPersonId(db, DEV_STAFF_LOGINS.captain.email);
    expect(await canPersonImportShopData(db, shop.id, captain)).toBe(false);

    expect(await canPersonImportShopData(db, "00000000-0000-0000-0000-000000000000", owner)).toBe(
      false,
    );

    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, owner));
    expect(await canPersonImportShopData(db, shop.id, owner)).toBe(false);
  });
});
