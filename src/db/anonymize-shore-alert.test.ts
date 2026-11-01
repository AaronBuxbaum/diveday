import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { people, personRoles, shopShoreAlertTokens, shops } from "./schema";
import { setShopShoreAlertContact } from "./shops";
import { issueShoreAlertStopToken } from "./shore-alert-tokens";

/**
 * Erasure reaches the shore contact's address (H-20261014-stale-roll-call-recipients security review). A diver
 * a shop also named as its shore contact asks to be forgotten: the address
 * leaves the shop's settings with its consent and confirmation, and the links
 * minted for it go too. An address that is not theirs is left alone.
 */
describe("anonymizeDiver — the shore contact's address", () => {
  async function setup(shoreEmail: string) {
    const { db, shop } = await seededShopContext();
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Rosa Shore", email: "rosa@example.com" })
      .returning();
    if (!diver) throw new Error("diver insert failed");
    const at = new Date("2026-10-15T12:00:00Z");
    await setShopShoreAlertContact(db, shop.id, {
      email: shoreEmail,
      consentAt: at,
      consentByPersonId: owner.id,
      confirmedAt: at,
    });
    await issueShoreAlertStopToken(db, { shopId: shop.id, email: shoreEmail });
    const erase = () =>
      anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: owner.id });
    const shore = async () => {
      const [row] = await db
        .select({
          email: shops.shoreAlertEmail,
          consentAt: shops.shoreAlertConsentAt,
          consentBy: shops.shoreAlertConsentByPersonId,
          confirmedAt: shops.shoreAlertConfirmedAt,
        })
        .from(shops)
        .where(eq(shops.id, shop.id));
      const tokens = await db
        .select({ id: shopShoreAlertTokens.id })
        .from(shopShoreAlertTokens)
        .where(eq(shopShoreAlertTokens.shopId, shop.id));
      return { ...row, tokens: tokens.length };
    };
    return { erase, shore };
  }

  it("clears the shop's shore contact when it is the erased diver's address", async () => {
    const { erase, shore } = await setup("Rosa@Example.com");
    expect((await erase()).ok).toBe(true);
    expect(await shore()).toEqual({
      email: null,
      consentAt: null,
      consentBy: null,
      confirmedAt: null,
      tokens: 0,
    });
  });

  it("leaves somebody else's shore address alone", async () => {
    const { erase, shore } = await setup("harbour@example.com");
    expect((await erase()).ok).toBe(true);
    expect(await shore()).toMatchObject({ email: "harbour@example.com", tokens: 1 });
  });
});
