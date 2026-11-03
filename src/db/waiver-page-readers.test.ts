import { and, eq, isNotNull, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { people, personRoles, waiverRecords } from "./schema";
import { getSignedWaiverPage } from "./signed-waiver-page";
import { getWaiversPage } from "./waivers-page";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

async function setup() {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const [record] = await db
    .select({ id: waiverRecords.id, personId: waiverRecords.personId })
    .from(waiverRecords)
    .where(and(eq(waiverRecords.shopId, shop.id), isNotNull(waiverRecords.signedAt)))
    .limit(1);
  if (!owner || !record?.personId) throw new Error("setup: owner or signed record missing");
  return { db, shop, owner, record: { id: record.id, personId: record.personId } };
}

describe("getSignedWaiverPage", () => {
  it("gives the owner the record, the shop's answers and the medical permissions", async () => {
    const { db, shop, owner, record } = await setup();
    const page = await getSignedWaiverPage(db, shop.id, record.personId, record.id, owner.id);
    expect(page?.waiver).toBeTruthy();
    expect(page?.shopAnswers).not.toBeNull();
    expect(page?.can).toEqual({
      readMedicalAnswers: true,
      openEvaluation: true,
      readMedicalAlert: true,
    });
  });

  it("reads no shop answers and no medical for a reader with no staff role", async () => {
    const { db, shop, record } = await setup();
    const staff = new Set(
      (
        await db
          .select({ id: personRoles.personId })
          .from(personRoles)
          .where(ne(personRoles.role, "diver"))
      ).map((row) => row.id),
    );
    const everyone = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id));
    const reader = everyone.find((row) => !staff.has(row.id));
    if (!reader) throw new Error("setup: no diver-only person");
    const page = await getSignedWaiverPage(db, shop.id, record.personId, record.id, reader.id);
    expect(page?.shopAnswers).toBeNull();
    expect(page?.can.readMedicalAnswers).toBe(false);
  });

  it("is null when the record is not this diver's", async () => {
    const { db, shop, owner, record } = await setup();
    expect(await getSignedWaiverPage(db, shop.id, owner.id, record.id, owner.id)).toBeNull();
  });
});

describe("getWaiversPage", () => {
  it("pins the named record and reads nothing pinned without one", async () => {
    const { db, shop, record } = await setup();
    const input = { page: 1, query: "", view: undefined };
    const pinned = await getWaiversPage(db, shop.id, { ...input, record: record.id });
    expect(pinned.highlighted).toBeTruthy();
    expect(pinned.auditPage.entries.length).toBeGreaterThan(0);
    const plain = await getWaiversPage(db, shop.id, input);
    expect(plain.highlighted).toBeNull();
    expect(plain.current).toBeTruthy();
  });
});
