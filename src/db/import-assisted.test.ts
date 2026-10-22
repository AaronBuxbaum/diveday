import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { prepareContactImport } from "@/test/import-fixture";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { commitContactImport } from "./import";
import { certifications, people, userAccounts, waiverRecords } from "./schema";

const ctx = fileScopedShopContext();

async function personByEmail(shopId: string, email: string) {
  const [row] = await ctx.db
    .select()
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.email, email), isNull(people.deletedAt)))
    .limit(1);
  return row ?? null;
}

async function accountPersonId(email: string) {
  const [account] = await ctx.db
    .select({ personId: userAccounts.personId })
    .from(userAccounts)
    .where(eq(userAccounts.email, email))
    .limit(1);
  if (!account) throw new Error(`no account for ${email}`);
  return account.personId;
}

/**
 * A column a Claude assist matched is not the shop's own header (ADR
 * 20261018-claude-assists, dive-domain review B1/B2): it never decides who a
 * row is or how old they are, and an emergency contact it found only fills a
 * blank.
 */
describe("commitContactImport — what an assisted column may change", () => {
  it("keeps an emergency contact on file and fills one that is blank", async () => {
    const { db, shop } = ctx;
    const importer = await accountPersonId(DEV_STAFF_LOGINS.owner.email);
    await commitContactImport(
      db,
      shop.id,
      prepareContactImport(
        [
          "full_name,email,emergency_contact_phone",
          "Ana Kept,ana.kept@example.com,+1 305 555 0101",
          "Bo Blank,bo.blank@example.com,",
        ].join("\n"),
      ),
      importer,
    );
    const reexport = [
      "full_name,email,Mobile 2",
      "Ana Kept,ana.kept@example.com,+1 305 555 0199",
      "Bo Blank,bo.blank@example.com,+1 305 555 0188",
    ].join("\n");
    await commitContactImport(
      db,
      shop.id,
      prepareContactImport(reexport, {
        headers: { "Mobile 2": "emergency_contact_phone" },
        levels: {},
      }),
      importer,
    );
    expect((await personByEmail(shop.id, "ana.kept@example.com"))?.emergencyContactPhone).toBe(
      "+1 305 555 0101",
    );
    expect((await personByEmail(shop.id, "bo.blank@example.com"))?.emergencyContactPhone).toBe(
      "+1 305 555 0188",
    );
  });

  it("never puts a verified card or a trusted waiver on a diver through an assisted email, or moves a birth date", async () => {
    const { db, shop } = ctx;
    const importer = await accountPersonId(DEV_STAFF_LOGINS.owner.email);
    await commitContactImport(
      db,
      shop.id,
      prepareContactImport(
        ["full_name,email,date_of_birth", "Ana Booker,ana.booker@example.com,2017-03-01"].join(
          "\n",
        ),
      ),
      importer,
    );
    const file = [
      "Name,Kontakt,Date,Certification Level,Cert Number,Agency,Waiver Signed",
      "Ben Buddy,ana.booker@example.com,1998-03-01,Divemaster,12345,PADI,yes",
    ].join("\n");
    await commitContactImport(
      db,
      shop.id,
      prepareContactImport(file, {
        headers: { Kontakt: "email", Date: "date_of_birth" },
        levels: {},
      }),
      importer,
    );
    const ana = await personByEmail(shop.id, "ana.booker@example.com");
    expect(ana).toMatchObject({ fullName: "Ana Booker", dateOfBirth: "2017-03-01" });
    if (!ana) throw new Error("expected Ana");
    expect(
      await db.select().from(certifications).where(eq(certifications.personId, ana.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(waiverRecords).where(eq(waiverRecords.personId, ana.id)),
    ).toHaveLength(0);
  });
});
