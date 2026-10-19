import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { issueAccountToken } from "./account-tokens";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { userAccounts } from "./schema";
import { issueShopContactEmailConfirmation } from "./shop-contact-email";
import { setShopShoreAlertContact } from "./shops";
import {
  checkShoreAlertConfirmation,
  consumeShoreAlertConfirmation,
  isShoreAlertToken,
  issueShoreAlertConfirmation,
  issueShoreAlertStopToken,
  resolveShoreAlertStopToken,
  stopShoreAlertsByToken,
} from "./shore-alert-tokens";
import { listStaff } from "./trips";

const ctx = fileScopedShopContext();
const at = new Date("2026-10-15T12:00:00.000Z");

async function shoreFixture(email = "shore@example.com") {
  const { db, shop } = ctx;
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("fixture staff missing");
  await setShopShoreAlertContact(db, shop.id, {
    email,
    consentAt: at,
    consentByPersonId: staff.person.id,
    confirmedAt: null,
  });
  return { db, shop, staffId: staff.person.id };
}

describe("adversarial token-purpose isolation (#2819)", () => {
  it("an account verification token cannot be redeemed as a shore alert confirmation or stop", async () => {
    const { db } = await shoreFixture();
    const [account] = await db
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(eq(userAccounts.email, DEV_STAFF_LOGINS.owner.email))
      .limit(1);
    if (!account) throw new Error("owner account missing");

    const accountToken = await issueAccountToken(db, {
      userAccountId: account.id,
      purpose: "email_verification",
      now: at,
    });

    expect(await isShoreAlertToken(db, { token: accountToken.token })).toBe(false);
    expect(
      await checkShoreAlertConfirmation(db, { token: accountToken.token, now: at }),
    ).toBeNull();
    expect(
      await consumeShoreAlertConfirmation(db, { token: accountToken.token, now: at }),
    ).toBeNull();
    expect(await resolveShoreAlertStopToken(db, accountToken.token)).toBeNull();
    expect(await stopShoreAlertsByToken(db, { token: accountToken.token, now: at })).toBeNull();
  });

  it("a shop contact email confirmation token cannot be redeemed as a shore alert confirmation or stop", async () => {
    const { db, shop } = await shoreFixture();
    const contactToken = await issueShopContactEmailConfirmation(db, {
      shopId: shop.id,
      email: "desk@example.com",
      now: at,
    });

    expect(await isShoreAlertToken(db, { token: contactToken.token })).toBe(false);
    expect(
      await checkShoreAlertConfirmation(db, { token: contactToken.token, now: at }),
    ).toBeNull();
    expect(
      await consumeShoreAlertConfirmation(db, { token: contactToken.token, now: at }),
    ).toBeNull();
    expect(await resolveShoreAlertStopToken(db, contactToken.token)).toBeNull();
    expect(await stopShoreAlertsByToken(db, { token: contactToken.token, now: at })).toBeNull();
  });

  it("a shore alert confirmation token cannot act as a stop token and vice versa", async () => {
    const { db, shop } = await shoreFixture();
    const confirm = await issueShoreAlertConfirmation(db, {
      shopId: shop.id,
      email: "shore@example.com",
      now: at,
    });
    const stop = await issueShoreAlertStopToken(db, {
      shopId: shop.id,
      email: "shore@example.com",
    });

    expect(await resolveShoreAlertStopToken(db, confirm.token)).toBeNull();
    expect(await stopShoreAlertsByToken(db, { token: confirm.token, now: at })).toBeNull();

    expect(await checkShoreAlertConfirmation(db, { token: stop, now: at })).toBeNull();
    expect(await consumeShoreAlertConfirmation(db, { token: stop, now: at })).toBeNull();
  });
});
