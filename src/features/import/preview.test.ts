import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPerson } from "@/db/people";
import { people, shops } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { prepareContactImport } from "@/test/import-fixture";
import { previewContactImportMatches } from "./preview";

const ctx = fileScopedShopContext();

describe("import roster match preview", () => {
  it("shows existing, new, same-file merge, and skipped outcomes within the session shop", async () => {
    const { db, shop } = ctx;
    const person = await createPerson(db, {
      shopId: shop.id,
      fullName: "Existing",
      email: "match@example.com",
      phone: null,
      origin: "import",
    });
    const prepared = prepareContactImport(
      "full_name,email\nExisting,match@example.com\nNew,new@example.com\nAgain,new@example.com\n,skip@example.com",
    );
    expect(await previewContactImportMatches(db, shop.id, prepared)).toEqual([
      { rowNumber: 1, outcome: "update" },
      { rowNumber: 2, outcome: "create" },
      { rowNumber: 3, outcome: "merge" },
      { rowNumber: 4, outcome: "skip" },
    ]);
    await db
      .update(people)
      .set({ deletedAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(people.id, person.id));
    expect((await previewContactImportMatches(db, shop.id, prepared))[0].outcome).toBe("create");
  });
  it("never reports a match held by another tenant", async () => {
    const { db, shop } = ctx;
    const [other] = await db
      .insert(shops)
      .values({ slug: "other-import-preview", name: "Other", timezone: "America/New_York" })
      .returning();
    await createPerson(db, {
      shopId: other.id,
      fullName: "Other",
      email: "other@example.com",
      phone: null,
      origin: "import",
    });
    const prepared = prepareContactImport("full_name,email\nNew,other@example.com");
    expect(await previewContactImportMatches(db, shop.id, prepared)).toEqual([
      { rowNumber: 1, outcome: "create" },
    ]);
  });
});

it("rechecks advisory matches at commit and repeats a manually mapped file without duplicate evidence, notes, or fit profiles", async () => {
  const { db, shop } = ctx;
  const { prepareContactImport: prepare } = await import("@/lib/import");
  const { commitContactImport } = await import("@/test/words-wiring");
  const { userAccounts, cards, waiverRecords, internalNotes, rentalFitProfiles } = await import(
    "@/db/schema"
  );
  const { DEV_STAFF_LOGINS } = await import("@/db/dev-credentials");
  const [account] = await db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.email, DEV_STAFF_LOGINS.owner.email));
  const prepared = prepare(
    "Guest,Mailbox,certification_level,certification_number,waiver_accepted,internal_notes,wetsuit_size\nRepeat Diver,repeat-manual@example.com,Open Water,MANUAL-OW-1,yes,Check fins,M",
    { today: "2026-11-16", manual: { Guest: "full_name", Mailbox: "email" } },
  );
  expect((await previewContactImportMatches(db, shop.id, prepared))[0].outcome).toBe("create");
  const first = await commitContactImport(db, shop.id, prepared, account.personId);
  const second = await commitContactImport(db, shop.id, prepared, account.personId);
  expect(first.peopleCreated).toBe(1);
  expect(second.peopleCreated).toBe(0);
  expect(second.peopleUpdated).toBe(1);
  expect((await previewContactImportMatches(db, shop.id, prepared))[0].outcome).toBe("update");
  const [person] = await db
    .select()
    .from(people)
    .where(eq(people.email, "repeat-manual@example.com"));
  const importedCards = await db.select().from(cards).where(eq(cards.personId, person.id));
  expect(importedCards).toHaveLength(1);
  expect(importedCards[0].status).toBe("pending");
  expect(
    await db.select().from(waiverRecords).where(eq(waiverRecords.personId, person.id)),
  ).toHaveLength(0);
  expect(
    await db.select().from(internalNotes).where(eq(internalNotes.personId, person.id)),
  ).toHaveLength(1);
  expect(
    await db.select().from(rentalFitProfiles).where(eq(rentalFitProfiles.personId, person.id)),
  ).toHaveLength(1);
});
