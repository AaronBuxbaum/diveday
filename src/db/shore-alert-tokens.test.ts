import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { ACTIVITY_CODE_KINDS } from "@/lib/shop-activity";
import { SHORE_ALERT_CONFIRMATION_TTL_MS } from "@/lib/shore-alert-contact";
import { fileScopedShopContext } from "@/test/db";
import { activityEvents, shops } from "./schema";
import { setShopShoreAlertContact } from "./shops";
import {
  checkShoreAlertConfirmation,
  consumeShoreAlertConfirmation,
  isShoreAlertToken,
  issueShoreAlertConfirmation,
  issueShoreAlertStopToken,
  resolveShoreAlertStopToken,
  stopShoreAlertsByToken,
  wasShoreAlertConfirmed,
} from "./shore-alert-tokens";
import { listStaff } from "./trips";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

const at = new Date("2026-10-15T12:00:00.000Z");

/** The shop names a consented, unconfirmed shore contact. */
async function shoreOnFile(email = "Shore@Example.com") {
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

async function shoreColumns() {
  const [row] = await ctx.db
    .select({
      email: shops.shoreAlertEmail,
      consentAt: shops.shoreAlertConsentAt,
      consentBy: shops.shoreAlertConsentByPersonId,
      confirmedAt: shops.shoreAlertConfirmedAt,
    })
    .from(shops)
    .where(eq(shops.id, ctx.shop.id));
  return row;
}

/** H-20261014-stale-roll-call-recipients review: no alert reaches an address before its inbox said yes. */
describe("confirming a shore contact's address", () => {
  it("resolves the link to the shop and address, and confirms on consume, once", async () => {
    const { db, shop } = await shoreOnFile();
    const issued = await issueShoreAlertConfirmation(db, {
      shopId: shop.id,
      email: "Shore@Example.com",
      now: at,
    });
    expect(issued.expiresAt).toEqual(new Date(at.getTime() + SHORE_ALERT_CONFIRMATION_TTL_MS));
    expect(await checkShoreAlertConfirmation(db, { token: issued.token, now: at })).toEqual({
      shopId: shop.id,
      shopName: shop.name,
      email: "shore@example.com",
    });
    expect(await wasShoreAlertConfirmed(db, { token: issued.token })).toBeNull();

    expect(await consumeShoreAlertConfirmation(db, { token: issued.token, now: at })).toEqual({
      shopId: shop.id,
    });
    expect((await shoreColumns())?.confirmedAt).toEqual(at);
    expect(await wasShoreAlertConfirmed(db, { token: issued.token })).toEqual({
      shopName: shop.name,
      email: "shore@example.com",
    });
    expect(await consumeShoreAlertConfirmation(db, { token: issued.token, now: at })).toBeNull();
    expect(await checkShoreAlertConfirmation(db, { token: issued.token, now: at })).toBeNull();
  });

  it("refuses a link minted for an address the shop has since changed", async () => {
    const { db, shop, staffId } = await shoreOnFile();
    const issued = await issueShoreAlertConfirmation(db, {
      shopId: shop.id,
      email: "shore@example.com",
      now: at,
    });
    await setShopShoreAlertContact(db, shop.id, {
      email: "other@example.com",
      consentAt: at,
      consentByPersonId: staffId,
      confirmedAt: null,
    });
    expect(await checkShoreAlertConfirmation(db, { token: issued.token, now: at })).toBeNull();
    expect(await consumeShoreAlertConfirmation(db, { token: issued.token, now: at })).toBeNull();
    expect((await shoreColumns())?.confirmedAt).toBeNull();
  });

  it("expires, and a fresh mint supersedes the outstanding link", async () => {
    const { db, shop } = await shoreOnFile();
    const first = await issueShoreAlertConfirmation(db, {
      shopId: shop.id,
      email: "shore@example.com",
      now: at,
    });
    const second = await issueShoreAlertConfirmation(db, {
      shopId: shop.id,
      email: "shore@example.com",
      now: at,
    });
    expect(await consumeShoreAlertConfirmation(db, { token: first.token, now: at })).toBeNull();
    const late = new Date(second.expiresAt.getTime() + 1);
    expect(await consumeShoreAlertConfirmation(db, { token: second.token, now: late })).toBeNull();
    expect((await shoreColumns())?.confirmedAt).toBeNull();
    // Still known as a shore link, so the page says so in the shore's words.
    expect(await isShoreAlertToken(db, { token: second.token })).toBe(true);
    expect(await isShoreAlertToken(db, { token: "nope" })).toBe(false);
  });

  it("is never a stop link, and a stop link never confirms", async () => {
    const { db, shop } = await shoreOnFile();
    const stop = await issueShoreAlertStopToken(db, {
      shopId: shop.id,
      email: "shore@example.com",
    });
    expect(await checkShoreAlertConfirmation(db, { token: stop, now: at })).toBeNull();
    expect(await consumeShoreAlertConfirmation(db, { token: stop, now: at })).toBeNull();
    const confirm = await issueShoreAlertConfirmation(db, {
      shopId: shop.id,
      email: "shore@example.com",
      now: at,
    });
    expect(await resolveShoreAlertStopToken(db, confirm.token)).toBeNull();
  });
});

/** H-20261014-stale-roll-call-recipients review: every alert carries a link that takes the address off the shop. */
describe("stopping shore alerts by the link in one", () => {
  it("clears the shop's shore contact, and a second use says it already has", async () => {
    const { db, shop } = await shoreOnFile();
    await db.update(shops).set({ shoreAlertConfirmedAt: at }).where(eq(shops.id, shop.id));
    const token = await issueShoreAlertStopToken(db, {
      shopId: shop.id,
      email: "Shore@Example.com",
    });
    expect(await resolveShoreAlertStopToken(db, token)).toEqual({
      shopId: shop.id,
      shopName: shop.name,
      alreadyStopped: false,
    });
    expect(await stopShoreAlertsByToken(db, { token, now: at })).toMatchObject({
      alreadyStopped: false,
    });
    expect(await shoreColumns()).toEqual({
      email: null,
      consentAt: null,
      consentBy: null,
      confirmedAt: null,
    });
    expect(await resolveShoreAlertStopToken(db, token)).toMatchObject({ alreadyStopped: true });
    expect(await stopShoreAlertsByToken(db, { token, now: at })).toMatchObject({
      alreadyStopped: true,
    });
  });

  it("leaves a different address the shop has since saved alone", async () => {
    const { db, shop, staffId } = await shoreOnFile();
    const token = await issueShoreAlertStopToken(db, {
      shopId: shop.id,
      email: "shore@example.com",
    });
    await setShopShoreAlertContact(db, shop.id, {
      email: "next@example.com",
      consentAt: at,
      consentByPersonId: staffId,
      confirmedAt: at,
    });
    expect(await stopShoreAlertsByToken(db, { token, now: at })).toMatchObject({
      alreadyStopped: true,
    });
    expect((await shoreColumns())?.email).toBe("next@example.com");
  });

  it("works once: a spent link cannot take the same address off again", async () => {
    const { db, shop, staffId } = await shoreOnFile();
    const token = await issueShoreAlertStopToken(db, {
      shopId: shop.id,
      email: "shore@example.com",
    });
    await stopShoreAlertsByToken(db, { token, now: at });
    // The shop adds the same address back and it confirms again.
    await setShopShoreAlertContact(db, shop.id, {
      email: "shore@example.com",
      consentAt: at,
      consentByPersonId: staffId,
      confirmedAt: at,
    });
    expect(await resolveShoreAlertStopToken(db, token)).toMatchObject({ alreadyStopped: true });
    expect(await stopShoreAlertsByToken(db, { token, now: at })).toMatchObject({
      alreadyStopped: true,
    });
    expect((await shoreColumns())?.email).toBe("shore@example.com");
  });

  it("tells the shop: a line in its log no account wrote, and an email to each owner", async () => {
    const { db, shop } = await shoreOnFile();
    await db
      .update(shops)
      .set({ shoreAlertConfirmedAt: at, isDemo: false })
      .where(eq(shops.id, shop.id));
    const token = await issueShoreAlertStopToken(db, {
      shopId: shop.id,
      email: "shore@example.com",
    });
    const sent: Notification[] = [];
    const provider: NotificationProvider = {
      async send(notification) {
        sent.push(notification);
        return { status: "sent", providerMessageId: `msg-${sent.length}` };
      },
    };
    const origin = "https://diveday.example";
    await stopShoreAlertsByToken(db, { token, now: at, origin, provider });

    const stoppedLines = () =>
      db
        .select({
          actor: activityEvents.actorPersonId,
          tripId: activityEvents.tripId,
          params: activityEvents.params,
        })
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.shopId, shop.id),
            eq(activityEvents.code, "shore_alert_contact_stopped"),
          ),
        );
    expect(await stoppedLines()).toEqual([{ actor: null, tripId: null, params: {} }]);
    expect(ACTIVITY_CODE_KINDS.shore_alert_contact_stopped).toBe("safety");

    expect(sent.length).toBeGreaterThan(0);
    for (const notification of sent) {
      if (notification.kind !== "shore_alert_stopped") throw new Error("wrong kind");
      expect(notification).toMatchObject({
        shopId: shop.id,
        settingsUrl: `${origin}/shop/${shop.slug}/settings/emergency-reference`,
        stoppedAt: at,
      });
      // The owners hear that it stopped, never the address it went to.
      expect(JSON.stringify(notification)).not.toContain("shore@example.com");
    }

    // A second use is already stopped: no second line, no second email.
    sent.length = 0;
    await stopShoreAlertsByToken(db, { token, now: at, origin, provider });
    expect(await stoppedLines()).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  it("is unknown for a token that was never minted", async () => {
    expect(await resolveShoreAlertStopToken(ctx.db, "nope")).toBeNull();
    expect(await stopShoreAlertsByToken(ctx.db, { token: "nope", now: at })).toBeNull();
  });
});
