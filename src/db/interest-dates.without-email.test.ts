// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { isOpenDateRequestWithoutEmail } from "./interest-dates";
import { addInterest } from "./interest-dates-fixtures";
import { interests, shops } from "./schema";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`), closed through `closePglite`.
const ctx = fileScopedShopContext();

/**
 * **The email-less request flag is read under the shop** (issue #3743): the
 * form field names a request, and the row decides. Real database, so the shop
 * scope is the query's own and not a mock's.
 */
describe("isOpenDateRequestWithoutEmail", () => {
  const preferredDate = "2027-03-10";

  it("is true for this shop's open date request with no email, or an empty one", async () => {
    const { db, shop } = ctx;
    const none = await addInterest(db, shop.id, { interest: "Reef", preferredDate });
    const empty = await addInterest(db, shop.id, { interest: "Reef", preferredDate, email: "" });
    expect(await isOpenDateRequestWithoutEmail(db, shop.id, none)).toBe(true);
    expect(await isOpenDateRequestWithoutEmail(db, shop.id, empty)).toBe(true);
  });

  it("is false for another shop's request, and for the same id asked of the wrong shop", async () => {
    const { db, shop } = ctx;
    const [other] = await db
      .insert(shops)
      .values({
        name: "Coral Ledge Divers",
        slug: "coral-ledge-no-email",
        timezone: "America/New_York",
      })
      .returning({ id: shops.id });
    if (!other) throw new Error("second shop not inserted");
    const theirs = await addInterest(db, other.id, { interest: "Reef", preferredDate });
    expect(await isOpenDateRequestWithoutEmail(db, other.id, theirs)).toBe(true);
    expect(await isOpenDateRequestWithoutEmail(db, shop.id, theirs)).toBe(false);
  });

  it("is false for a closed request, one with an email, and an id nobody holds", async () => {
    const { db, shop } = ctx;
    const closed = await addInterest(db, shop.id, { interest: "Reef", preferredDate });
    await db
      .update(interests)
      .set({ closedAt: nowDate(), closedAs: "done" })
      .where(eq(interests.id, closed));
    const withEmail = await addInterest(db, shop.id, {
      interest: "Reef",
      preferredDate,
      email: "mia@example.com",
    });
    expect(await isOpenDateRequestWithoutEmail(db, shop.id, closed)).toBe(false);
    expect(await isOpenDateRequestWithoutEmail(db, shop.id, withEmail)).toBe(false);
    expect(
      await isOpenDateRequestWithoutEmail(db, shop.id, "00000000-0000-4000-8000-000000000099"),
    ).toBe(false);
  });
});
