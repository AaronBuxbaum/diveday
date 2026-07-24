// @vitest-environment node
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { prepareContactImport } from "@/lib/import";
import { isCompletedWaiverCurrent } from "@/lib/waivers";
import { seededShopContext } from "@/test/db";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { canPersonImportShopData, commitContactImport } from "./import";
import {
  certifications,
  nitroxCertifications,
  people,
  personRoles,
  rentalFitProfiles,
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
  it("creates divers with a diver role, a claimed card, and a rental fit", async () => {
    const { db, shop } = await seededShopContext();
    const csv = [
      "full_name,email,phone,certification_agency,certification_level,certification_number,certification_status,wetsuit_size,fin_size",
      "Nadia Okonkwo,nadia.import@example.com,+1 305 555 0140,PADI,Advanced Open Water,AOW-778,verified,3mm/M,L",
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
    // The source said "verified"; the card is stored pending. This is the line.
    expect(card).toMatchObject({ level: "advanced_open_water", agency: "padi", status: "pending" });

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

  it("imports a nitrox card as claimed (pending), never a fill authorization", async () => {
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
    expect(card).toMatchObject({ identifier: "NX-9001", status: "pending" });
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
    expect(prepared.rows[0]?.issues.some((i) => /isn't a real calendar date/.test(i.message))).toBe(
      true,
    );
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
      expiresAt: new Date(),
      signedName: "Held Hana",
      signatureMethod: "typed_consent",
      consentedAt: new Date(),
      signedAt: new Date(),
      medicalReviewRequired: true,
      completedAt: new Date(),
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
      .set({ archivedAt: new Date() })
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
