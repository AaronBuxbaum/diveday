import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { SHOP_CONTACT_EMAIL_TTL_MS } from "@/lib/shop-contact-email";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { shops } from "./schema";
import {
  checkShopContactEmailToken,
  confirmShopContactEmail,
  issueShopContactEmailToken,
  wasShopContactEmailTokenConsumed,
} from "./shop-contact-email";
import { setShopContact } from "./shops";

const ADDRESS = "front-desk@bluemantis.dive";

async function confirmedAt(db: AppDb, shopId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: shops.contactEmailConfirmedAt })
    .from(shops)
    .where(eq(shops.id, shopId));
  return row?.at ?? null;
}

/** The shop with the address on file and nobody having proved it yet. */
async function shopWithUnconfirmedAddress() {
  const { db, shop } = await seededShopContext();
  await setShopContact(db, shop.id, { contactEmail: ADDRESS, contactPhone: "" });
  return { db, shop };
}

describe("issueShopContactEmailToken", () => {
  it("mints a live token for the address on file", async () => {
    const { db, shop } = await shopWithUnconfirmedAddress();
    const issued = await issueShopContactEmailToken(db, { shopId: shop.id, email: ADDRESS });
    await expect(checkShopContactEmailToken(db, { token: issued.token })).resolves.toEqual({
      shopId: shop.id,
      email: ADDRESS,
    });
  });

  it("supersedes the previous outstanding link — a second save invalidates the first", async () => {
    const { db, shop } = await shopWithUnconfirmedAddress();
    const first = await issueShopContactEmailToken(db, { shopId: shop.id, email: ADDRESS });
    const second = await issueShopContactEmailToken(db, { shopId: shop.id, email: ADDRESS });

    await expect(checkShopContactEmailToken(db, { token: first.token })).resolves.toBeNull();
    await expect(checkShopContactEmailToken(db, { token: second.token })).resolves.not.toBeNull();
  });

  it("expires", async () => {
    const { db, shop } = await shopWithUnconfirmedAddress();
    const issuedAt = new Date("2026-07-21T13:30:00.000Z");
    const issued = await issueShopContactEmailToken(db, {
      shopId: shop.id,
      email: ADDRESS,
      now: issuedAt,
    });
    const justInside = new Date(issuedAt.getTime() + SHOP_CONTACT_EMAIL_TTL_MS - HOUR_MS);
    const justOutside = new Date(issuedAt.getTime() + SHOP_CONTACT_EMAIL_TTL_MS + HOUR_MS);

    await expect(
      checkShopContactEmailToken(db, { token: issued.token, now: justInside }),
    ).resolves.not.toBeNull();
    await expect(
      checkShopContactEmailToken(db, { token: issued.token, now: justOutside }),
    ).resolves.toBeNull();
  });
});

describe("confirmShopContactEmail", () => {
  it("stamps the shop and burns the link", async () => {
    const { db, shop } = await shopWithUnconfirmedAddress();
    expect(await confirmedAt(db, shop.id)).toBeNull();
    const issued = await issueShopContactEmailToken(db, { shopId: shop.id, email: ADDRESS });

    const claimed = await confirmShopContactEmail(db, { token: issued.token });
    expect(claimed).toEqual({ shopId: shop.id, email: ADDRESS });
    expect(await confirmedAt(db, shop.id)).toBeInstanceOf(Date);
    await expect(wasShopContactEmailTokenConsumed(db, issued.token)).resolves.toBe(true);

    // One-time: a second submit of the same link claims nothing.
    await expect(confirmShopContactEmail(db, { token: issued.token })).resolves.toBeNull();
  });

  /**
   * The attack this whole feature exists to stop, in its subtlest form. A
   * manager asks for a link at an address they genuinely control, then edits the
   * field to somebody else's address and opens the first link. Without the
   * address re-check on the claim, that would mark the *second* address
   * confirmed and start routing every diver's reply — waiver answers included —
   * to a third party.
   */
  it("refuses a link for an address the shop has since changed away from", async () => {
    const { db, shop } = await shopWithUnconfirmedAddress();
    const issued = await issueShopContactEmailToken(db, { shopId: shop.id, email: ADDRESS });

    await setShopContact(db, shop.id, {
      contactEmail: "somebody-else@example.invalid",
      contactPhone: "",
    });

    await expect(confirmShopContactEmail(db, { token: issued.token })).resolves.toBeNull();
    expect(await confirmedAt(db, shop.id)).toBeNull();
    // And the link is not burned by the refusal — it simply does not apply.
    await expect(wasShopContactEmailTokenConsumed(db, issued.token)).resolves.toBe(false);
  });

  it("is null for a token nobody minted", async () => {
    const { db, shop } = await shopWithUnconfirmedAddress();
    await expect(confirmShopContactEmail(db, { token: "not-a-real-token" })).resolves.toBeNull();
    expect(await confirmedAt(db, shop.id)).toBeNull();
  });
});

describe("setShopContact and the confirmation stamp", () => {
  it("clears the stamp when the address changes", async () => {
    const { db, shop } = await shopWithUnconfirmedAddress();
    const issued = await issueShopContactEmailToken(db, { shopId: shop.id, email: ADDRESS });
    await confirmShopContactEmail(db, { token: issued.token });
    expect(await confirmedAt(db, shop.id)).toBeInstanceOf(Date);

    await setShopContact(db, shop.id, { contactEmail: "moved@example.invalid", contactPhone: "" });
    expect(await confirmedAt(db, shop.id)).toBeNull();
  });

  /**
   * The proof is about one address, not about the form. Saving the phone number
   * alone — or re-saving the same address — must not cost a shop its
   * confirmation and silently drop `Reply-To` off its diver mail.
   */
  it("keeps the stamp when the address does not change", async () => {
    const { db, shop } = await shopWithUnconfirmedAddress();
    const issued = await issueShopContactEmailToken(db, { shopId: shop.id, email: ADDRESS });
    await confirmShopContactEmail(db, { token: issued.token });
    const stamped = await confirmedAt(db, shop.id);

    await setShopContact(db, shop.id, {
      contactEmail: ADDRESS,
      contactPhone: "+1 305 555 0100",
    });
    expect(await confirmedAt(db, shop.id)).toEqual(stamped);
  });

  it("clears the stamp when the address is emptied", async () => {
    const { db, shop } = await shopWithUnconfirmedAddress();
    const issued = await issueShopContactEmailToken(db, { shopId: shop.id, email: ADDRESS });
    await confirmShopContactEmail(db, { token: issued.token });

    await setShopContact(db, shop.id, { contactEmail: "", contactPhone: "" });
    expect(await confirmedAt(db, shop.id)).toBeNull();
  });
});
