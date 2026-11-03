import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { bookings, people, personRoles } from "./schema";
import {
  premergeCertifications,
  premergeNitroxCertifications,
  premergeSpecialtyCertifications,
} from "./schema-retired/premerge-cards";

/**
 * Erasure reaches the copy of a diver's cards in the three tables the ledger
 * replaced (issue #2722). They stay in the database for one release, and a
 * card number left there would outlive the request in a table no screen reads.
 */
describe("anonymizeDiver — the retired card tables", () => {
  it("redacts the diver's numbers and notes in all three", async () => {
    const { db, shop } = await seededShopContext();
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    const [booking] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(and(eq(bookings.shopId, shop.id), ne(bookings.status, "cancelled")))
      .orderBy(bookings.id)
      .limit(1);
    if (!booking) throw new Error("expected a seeded booking");
    const personId = booking.personId;
    const card = { shopId: shop.id, personId, agency: "padi" as const, reviewNote: "seen at desk" };
    await db.insert(premergeCertifications).values({
      ...card,
      level: "open_water",
      identifier: "PREMERGE-LEVEL",
      declaredIdentifier: "PREMERGE-TYPED",
      importedFromLabel: "Old Shop",
    });
    await db
      .insert(premergeSpecialtyCertifications)
      .values({ ...card, specialty: "deep", identifier: "PREMERGE-DEEP" });
    await db
      .insert(premergeNitroxCertifications)
      .values({ ...card, identifier: "PREMERGE-EANX", importedFromLabel: "Old Shop" });
    // Another diver's card in the same shop is not the request's to touch.
    const [other] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), ne(people.id, personId), ne(people.id, owner.id)))
      .limit(1);
    if (!other) throw new Error("expected another seeded person");
    await db
      .insert(premergeNitroxCertifications)
      .values({ shopId: shop.id, personId: other.id, agency: "padi", identifier: "KEEP-ME" });

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const [level] = await db
      .select()
      .from(premergeCertifications)
      .where(eq(premergeCertifications.personId, personId));
    expect(level?.identifier).toMatch(/^redacted-/);
    expect(level).toMatchObject({
      declaredIdentifier: null,
      reviewNote: null,
      importedFromLabel: null,
    });
    expect(level?.deletedAt).not.toBeNull();
    for (const table of [premergeSpecialtyCertifications, premergeNitroxCertifications]) {
      const rows = await db.select().from(table).where(eq(table.personId, personId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.identifier).toMatch(/^redacted-/);
      expect(rows[0]).toMatchObject({ reviewNote: null, importedFromLabel: null });
      expect(rows[0]?.deletedAt).not.toBeNull();
    }
    const [kept] = await db
      .select()
      .from(premergeNitroxCertifications)
      .where(eq(premergeNitroxCertifications.personId, other.id));
    expect(kept?.identifier).toBe("KEEP-ME");
  });
});
