import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPerson } from "@/db/people";
import { people, shops } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { prepareContactImport } from "@/test/import-fixture";
import { previewContactImportMatches } from "./preview";

const ctx = fileScopedShopContext();

describe("import roster match preview", () => {
  it("shows existing, conflicting shared-email, and skipped outcomes within the session shop", async () => {
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
      { rowNumber: 2, outcome: "conflict" },
      { rowNumber: 3, outcome: "conflict" },
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

it.each(["recognized", "assisted", "manual"] as const)(
  "shows %s name conflicts and revalidates roster changes",
  async (mode) => {
    const { prepareContactImport: prepare } = await import("@/lib/import");
    const { commitContactImport } = await import("@/test/words-wiring");
    const { userAccounts } = await import("@/db/schema");
    const { DEV_STAFF_LOGINS } = await import("@/db/dev-credentials");
    const [account] = await ctx.db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.email, DEV_STAFF_LOGINS.owner.email));
    const person = await createPerson(ctx.db, {
      shopId: ctx.shop.id,
      fullName: "Original Diver",
      email: "stale-name@example.com",
      phone: null,
      origin: "import",
    });
    const prepared = prepare(
      `${mode === "manual" ? "Guest,Mailbox" : "full_name,email,Extra"}\nOriginal Diver,stale-name@example.com${mode === "manual" ? "" : ",note"}`,
      {
        today: "2026-11-16",
        ...(mode === "manual"
          ? { manual: { Guest: "full_name" as const, Mailbox: "email" as const } }
          : {}),
        ...(mode === "assisted"
          ? { assist: { headers: { Extra: "internal_notes" as const }, levels: {} } }
          : {}),
      },
    );
    expect((await previewContactImportMatches(ctx.db, ctx.shop.id, prepared))[0].outcome).toBe(
      "update",
    );
    await ctx.db
      .update(people)
      .set({ fullName: "Different Person" })
      .where(eq(people.id, person.id));
    expect((await previewContactImportMatches(ctx.db, ctx.shop.id, prepared))[0].outcome).toBe(
      "conflict",
    );
    const result = await commitContactImport(ctx.db, ctx.shop.id, prepared, account.personId);
    expect(result.peopleUpdated).toBe(0);
    expect(result.identityConflicts).toBe(1);
  },
);

it("previews existing and repeated past-booking history without creating seats", async () => {
  const { db, shop } = ctx;
  const { priorVisits, bookings } = await import("@/db/schema");
  const person = await createPerson(db, {
    shopId: shop.id,
    fullName: "History Diver",
    email: "history-preview@example.com",
    phone: null,
    origin: "import",
  });
  const prepared = prepareContactImport(
    "full_name,email,visit_date,visit_title,visit_reference\nHistory Diver,history-preview@example.com,2026-01-01,Reef,OLD-1\nHistory Diver,history-preview@example.com,2026-02-01,Reef,NEW-2\nHistory Diver,history-preview@example.com,2026-02-01,Reef,NEW-2",
  );
  const firstVisit = prepared.rows[0].visit;
  if (!firstVisit) throw new Error("Expected a parsed past visit");
  await db.insert(priorVisits).values({
    shopId: shop.id,
    personId: person.id,
    visitedOn: "2026-01-01",
    dedupeKey: firstVisit.dedupeKey,
    importedAt: new Date("2026-11-16T00:00:00Z"),
  });
  const before = await db.select({ id: bookings.id }).from(bookings);
  expect(
    (await previewContactImportMatches(db, shop.id, prepared)).map((row) => row.visitOutcome),
  ).toEqual(["existing", "add", "duplicate"]);
  expect(await db.select({ id: bookings.id }).from(bookings)).toEqual(before);
});
