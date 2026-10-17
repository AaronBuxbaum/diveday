import { describe, expect, it } from "vitest";
import { shopSenderOf } from "@/lib/notifications/sender";
import { unseededTestDb } from "@/test/db";
import { recordSetupRequest } from "./funnel";
import { issueSetupLink } from "./setup-links";
import { createSignedUpShop } from "./shop-signup";
import { clearShopNameReview } from "./shops";

type Db = Awaited<ReturnType<typeof unseededTestDb>>;

async function signUp(db: Db, shopName: string, slug: string) {
  const request = await recordSetupRequest(db, {
    shopName,
    region: "Key Largo",
    runsBoat: true,
    currentSystem: "paper",
    contactName: "Ana Ruiz",
    email: `${slug}@example.test`,
    phone: null,
    source: "pricing",
    locale: "en-US",
  });
  const link = await issueSetupLink(db, { setupRequestId: request.id });
  const outcome = await createSignedUpShop(db, {
    setupToken: link.token,
    shopName,
    shopSlug: slug,
    timezone: "America/New_York",
    ownerName: "Ana Ruiz",
    ownerEmail: `${slug}@example.test`,
    ownerPassword: "a-long-enough-password-1",
  });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.shop;
}

const off = { EMAIL_INBOUND_DOMAIN: "" };

/** Issue #2450: a sign-up name that could pass for a brand is held, and a human clears it. */
describe("a shop name held for review at sign-up", () => {
  it("flags a name that reads as a brand, and mails as plain DiveDay until cleared", async () => {
    const db = await unseededTestDb();
    const shop = await signUp(db, "PayPal Security", "paypal-security");
    const flaggedAt = shop.nameFlaggedAt;
    if (!flaggedAt) throw new Error("expected the name to be flagged");
    expect(shopSenderOf({ ...shop, contactEmail: null }, off)).toEqual({ nameUnderReview: true });

    const cleared = await clearShopNameReview(db, shop.id, new Date(flaggedAt.getTime() + 1000));
    expect(cleared?.nameClearedAt).toBeInstanceOf(Date);
    expect(shopSenderOf({ ...cleared, contactEmail: null }, off)).toBeUndefined();
  });

  it("leaves an ordinary dive shop name unflagged", async () => {
    const db = await unseededTestDb();
    const shop = await signUp(db, "Blue Mantis Divers", "blue-mantis-divers");
    expect(shop.nameFlaggedAt).toBeNull();
    expect(shopSenderOf({ ...shop, contactEmail: null }, off)).toBeUndefined();
  });

  it("clearing a shop that does not exist is null", async () => {
    const db = await unseededTestDb();
    expect(await clearShopNameReview(db, "00000000-0000-4000-8000-0000000000ff")).toBeNull();
  });
});
