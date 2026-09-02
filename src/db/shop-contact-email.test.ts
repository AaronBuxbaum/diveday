import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { shopContactEmailConfirmationTokens, shops } from "./schema";
import {
  checkShopContactEmailConfirmation,
  consumeShopContactEmailConfirmation,
  issueShopContactEmailConfirmation,
  wasShopContactEmailConfirmed,
} from "./shop-contact-email";
import { setShopContact } from "./shops";

const at = new Date("2026-09-02T12:00:00.000Z");

async function shopWithAddress(email = "Desk@BlueMantis.dive") {
  const { db, shop } = await seededShopContext();
  await setShopContact(db, shop.id, { contactEmail: email, contactPhone: "" });
  return { db, shop };
}

async function confirmedAt(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
) {
  const [row] = await db
    .select({ at: shops.contactEmailConfirmedAt, email: shops.contactEmail })
    .from(shops)
    .where(eq(shops.id, shopId));
  return row;
}

// Issue #1288: a typed front-desk address becomes Reply-To on diver mail only
// once the shop has opened the link sent to it.
describe("confirming a shop's contact email", () => {
  it("starts unconfirmed, resolves the link to the shop and address, and confirms on consume", async () => {
    const { db, shop } = await shopWithAddress();
    expect((await confirmedAt(db, shop.id))?.at).toBeNull();

    const issued = await issueShopContactEmailConfirmation(db, {
      shopId: shop.id,
      email: "Desk@BlueMantis.dive",
      now: at,
    });
    expect(await checkShopContactEmailConfirmation(db, { token: issued.token, now: at })).toEqual({
      shopId: shop.id,
      shopName: shop.name,
      email: "desk@bluemantis.dive",
    });
    expect(await wasShopContactEmailConfirmed(db, { token: issued.token })).toBeNull();

    expect(await consumeShopContactEmailConfirmation(db, { token: issued.token, now: at })).toEqual(
      { shopId: shop.id },
    );
    expect((await confirmedAt(db, shop.id))?.at).toEqual(at);
    expect(await wasShopContactEmailConfirmed(db, { token: issued.token })).toEqual({
      shopName: shop.name,
      email: "desk@bluemantis.dive",
    });
    // Spent: a second submit of the same link does nothing, and the page reads
    // the spent state rather than a live one.
    expect(
      await consumeShopContactEmailConfirmation(db, { token: issued.token, now: at }),
    ).toBeNull();
    expect(
      await checkShopContactEmailConfirmation(db, { token: issued.token, now: at }),
    ).toBeNull();
  });

  it("refuses a link minted for an address the shop has since changed", async () => {
    const { db, shop } = await shopWithAddress();
    const issued = await issueShopContactEmailConfirmation(db, {
      shopId: shop.id,
      email: "desk@bluemantis.dive",
      now: at,
    });
    await setShopContact(db, shop.id, { contactEmail: "other@bluemantis.dive", contactPhone: "" });

    expect(
      await checkShopContactEmailConfirmation(db, { token: issued.token, now: at }),
    ).toBeNull();
    expect(
      await consumeShopContactEmailConfirmation(db, { token: issued.token, now: at }),
    ).toBeNull();
    expect((await confirmedAt(db, shop.id))?.at).toBeNull();
  });

  it("expires, and a fresh mint supersedes the outstanding link", async () => {
    const { db, shop } = await shopWithAddress();
    const first = await issueShopContactEmailConfirmation(db, {
      shopId: shop.id,
      email: "desk@bluemantis.dive",
      now: at,
    });
    const fourDaysOn = new Date(at.getTime() + 4 * 24 * 60 * 60 * 1_000);
    expect(
      await checkShopContactEmailConfirmation(db, { token: first.token, now: fourDaysOn }),
    ).toBeNull();

    const second = await issueShopContactEmailConfirmation(db, {
      shopId: shop.id,
      email: "desk@bluemantis.dive",
      now: at,
    });
    expect(await checkShopContactEmailConfirmation(db, { token: first.token, now: at })).toBeNull();
    expect(
      await checkShopContactEmailConfirmation(db, { token: second.token, now: at }),
    ).not.toBeNull();
    const rows = await db
      .select({ superseded: shopContactEmailConfirmationTokens.supersededAt })
      .from(shopContactEmailConfirmationTokens)
      .where(eq(shopContactEmailConfirmationTokens.shopId, shop.id));
    expect(rows.filter((row) => row.superseded !== null)).toHaveLength(1);
  });

  // The shop stamped is the token's own, never a caller's: a link minted for
  // one shop cannot touch another's row, and each shop's mint supersedes only
  // its own outstanding link.
  it("confirms the shop it was minted for and no other", async () => {
    const { db, shop } = await shopWithAddress("desk@bluemantis.dive");
    const [other] = await db
      .insert(shops)
      .values({
        name: "Other Reef",
        slug: "other-reef",
        timezone: "America/New_York",
        contactEmail: "desk@bluemantis.dive",
      })
      .returning({ id: shops.id });
    if (!other) throw new Error("second shop insert failed");
    const forOther = await issueShopContactEmailConfirmation(db, {
      shopId: other.id,
      email: "desk@bluemantis.dive",
      now: at,
    });
    const forShop = await issueShopContactEmailConfirmation(db, {
      shopId: shop.id,
      email: "desk@bluemantis.dive",
      now: at,
    });

    expect(
      await consumeShopContactEmailConfirmation(db, { token: forShop.token, now: at }),
    ).toEqual({ shopId: shop.id });
    expect((await confirmedAt(db, shop.id))?.at).toEqual(at);
    expect((await confirmedAt(db, other.id))?.at).toBeNull();
    // The other shop's own link is untouched by the first shop's mint and consume.
    expect(
      await checkShopContactEmailConfirmation(db, { token: forOther.token, now: at }),
    ).not.toBeNull();
  });

  it("is unknown for a token that was never minted", async () => {
    const { db } = await seededShopContext();
    expect(
      await checkShopContactEmailConfirmation(db, { token: "not-a-token", now: at }),
    ).toBeNull();
    expect(await wasShopContactEmailConfirmed(db, { token: "not-a-token" })).toBeNull();
  });
});

describe("saving the contact email", () => {
  it("clears the confirmation when the address changes, and keeps it when it does not", async () => {
    const { db, shop } = await shopWithAddress("desk@bluemantis.dive");
    const issued = await issueShopContactEmailConfirmation(db, {
      shopId: shop.id,
      email: "desk@bluemantis.dive",
      now: at,
    });
    await consumeShopContactEmailConfirmation(db, { token: issued.token, now: at });
    expect((await confirmedAt(db, shop.id))?.at).toEqual(at);

    // Same address, different case and a phone change: the proof stands.
    await setShopContact(db, shop.id, {
      contactEmail: "DESK@bluemantis.dive",
      contactPhone: "+1 305",
    });
    expect(await confirmedAt(db, shop.id)).toMatchObject({
      at,
      email: "DESK@bluemantis.dive",
    });

    // A different address: the proof was for the old one and goes with it.
    await setShopContact(db, shop.id, { contactEmail: "front@bluemantis.dive", contactPhone: "" });
    expect((await confirmedAt(db, shop.id))?.at).toBeNull();

    // Cleared entirely: nothing left to vouch for.
    await setShopContact(db, shop.id, { contactEmail: "desk@bluemantis.dive", contactPhone: "" });
    await setShopContact(db, shop.id, { contactEmail: "", contactPhone: "" });
    expect(await confirmedAt(db, shop.id)).toEqual({ at: null, email: null });
  });
});
