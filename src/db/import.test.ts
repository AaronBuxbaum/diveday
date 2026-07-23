// @vitest-environment node
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { prepareContactImport } from "@/lib/import";
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
    const summary = await commitContactImport(db, shop.id, prepareContactImport(csv));
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
    const first = "full_name,email,phone\nRepeat Rita,rita.import@example.com,111";
    await commitContactImport(db, shop.id, prepareContactImport(first));

    const second = [
      "full_name,email,phone,certification_agency,certification_level,certification_number",
      "Repeat Rita,RITA.IMPORT@example.com,222,SSI,Open Water,OW-555",
    ].join("\n");
    const summary = await commitContactImport(db, shop.id, prepareContactImport(second));
    expect(summary).toMatchObject({ peopleCreated: 0, peopleUpdated: 1, cardsAdded: 1 });

    // One person, phone updated in place.
    const [person] = await db
      .select()
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, "rita.import@example.com")));
    expect(person).toMatchObject({ phone: "222" });

    // Re-importing the same card number does not touch it a second time.
    const again = await commitContactImport(db, shop.id, prepareContactImport(second));
    expect(again).toMatchObject({ cardsAdded: 0, cardsSkippedExisting: 1, peopleUpdated: 1 });
  });

  it("imports a nitrox card as claimed (pending), never a fill authorization", async () => {
    const { db, shop } = await seededShopContext();
    const csv = [
      "full_name,email,nitrox_certified,nitrox_certification_number",
      "Enzo Nitrox,enzo.import@example.com,yes,NX-9001",
    ].join("\n");
    const summary = await commitContactImport(db, shop.id, prepareContactImport(csv));
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
    const summary = await commitContactImport(db, shop.id, prepareContactImport(csv));
    expect(summary).toMatchObject({ peopleCreated: 1, rowsSkipped: 1 });
    expect(await personByEmail(db, shop.id, "nameless.import@example.com")).toBeNull();
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
