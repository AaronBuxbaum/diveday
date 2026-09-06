import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { discardFormDraft, listFreshFormDrafts, readFormDraft, saveFormDraft } from "./form-drafts";
import { people, personRoles } from "./schema";

async function fixture() {
  const { db, shop } = await seededShopContext();
  const [owner] = await db
    .select({ personId: personRoles.personId })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(eq(people.shopId, shop.id))
    .limit(1);
  if (!owner) throw new Error("fixture needs a staffer");
  return { db, shop, personId: owner.personId };
}

const now = new Date("2026-08-27T10:02:00Z");

/** ADR 20260906-before-you-ask, decision 3: nothing you typed is lost, for a day. */
describe("form drafts", () => {
  it("keeps what was typed, one row per person and form, and reads it back fresh", async () => {
    const { db, shop, personId } = await fixture();
    await saveFormDraft(db, {
      shopId: shop.id,
      personId,
      form: "new_diver",
      now,
      fields: [
        ["fullName", "Emmet O'Brien"],
        ["email", "emmet.ob@example.com"],
        ["cardNumber", "4242"],
      ],
    });
    await saveFormDraft(db, {
      shopId: shop.id,
      personId,
      form: "new_diver",
      now: new Date(now.getTime() + 60_000),
      fields: [
        ["fullName", "Emmet O'Brien"],
        ["email", "emmet.ob@example.com"],
        ["phone", "+1 305 555 0199"],
      ],
    });
    const draft = await readFormDraft(db, shop.id, personId, "new_diver", now);
    expect(draft?.fields).toEqual({
      fullName: "Emmet O'Brien",
      email: "emmet.ob@example.com",
      phone: "+1 305 555 0199",
    });
    expect(await listFreshFormDrafts(db, shop.id, personId, now)).toMatchObject([
      { form: "new_diver" },
    ]);
  });

  it("drops a draft after a day, and a form of blanks clears one", async () => {
    const { db, shop, personId } = await fixture();
    await saveFormDraft(db, {
      shopId: shop.id,
      personId,
      form: "add_departure",
      now,
      fields: [["title", "Two-Tank Reef"]],
    });
    const later = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    expect(await readFormDraft(db, shop.id, personId, "add_departure", later)).toBeNull();
    expect(await listFreshFormDrafts(db, shop.id, personId, later)).toEqual([]);

    expect(
      await saveFormDraft(db, {
        shopId: shop.id,
        personId,
        form: "add_departure",
        now,
        fields: [["title", "   "]],
      }),
    ).toBe("empty");
    expect(await readFormDraft(db, shop.id, personId, "add_departure", now)).toBeNull();
  });

  it("is one person's, and Start over discards it", async () => {
    const { db, shop, personId } = await fixture();
    await saveFormDraft(db, {
      shopId: shop.id,
      personId,
      form: "new_diver",
      now,
      fields: [["fullName", "Ada Lindqvist"]],
    });
    const stranger = "00000000-0000-4000-8000-000000000000";
    expect(await readFormDraft(db, shop.id, stranger, "new_diver", now)).toBeNull();
    await discardFormDraft(db, shop.id, personId, "new_diver");
    expect(await readFormDraft(db, shop.id, personId, "new_diver", now)).toBeNull();
  });
});
