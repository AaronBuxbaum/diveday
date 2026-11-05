import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { capabilities, people, shops, userAccounts, weeklyDigestSends } from "@/db/schema";
import {
  listWeeklyDigestRecipients,
  resolveWeeklyDigestUnsubscribeToken,
  turnOffWeeklyDigestByToken,
  type WeeklyDigestShop,
} from "@/db/weekly-digest";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { dbNow, fileScopedShopContext, type seededShopContext } from "@/test/db";
import { sendWeeklyDigestForShop } from "./digest";

/**
 * The Monday email's way out (issue #3721, security-sensitive: a bearer
 * link). The link is a `weekly_digest_unsubscribe` capability, minted once the
 * week's claim lands and kept apart from it, so it outlives the claim's prune.
 */
// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

const ORIGIN = "https://diveday.example";

function capturingProvider() {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      return { status: "sent", providerMessageId: `m-${sent.length}` };
    },
  };
  return { sent, provider };
}

/**
 * 10:00 on the first Monday after the seed's own clock, in the demo shop's
 * zone (New York): the seed's departures straddle "now", so this week's board
 * has boats on it and last week has history behind it.
 */
async function nextMondayMorning(db: Awaited<ReturnType<typeof seededShopContext>>["db"]) {
  const now = await dbNow(db);
  const monday = new Date(now);
  monday.setUTCHours(14, 0, 0, 0);
  while (monday.getUTCDay() !== 1 || monday <= now) {
    monday.setUTCDate(monday.getUTCDate() + 1);
  }
  return monday;
}

async function context() {
  const { db, shop } = ctx;
  const digestShop: WeeklyDigestShop = {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    timezone: shop.timezone,
    defaultLocale: shop.defaultLocale,
    diversPerDivemaster: shop.diversPerDivemaster,
    currency: shop.currency,
  };
  const staff = await db
    .select({ personId: people.id, email: userAccounts.email })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .where(eq(people.shopId, shop.id));
  const owner = staff.find((row) => row.email === "dana@demo.invalid");
  const instructor = staff.find((row) => row.email === "marcus@demo.invalid");
  const captain = staff.find((row) => row.email === "sal@demo.invalid");
  if (!owner || !instructor || !captain) throw new Error("seeded staff missing");
  return {
    db,
    shop: digestShop,
    owner,
    instructor,
    captain,
    monday: await nextMondayMorning(db),
  };
}

describe("the Monday email's opt-out link", () => {
  it("is turned off by the link it carried, idempotently", async () => {
    const { db, shop, owner, monday } = await context();
    const { sent, provider } = capturingProvider();
    await sendWeeklyDigestForShop(db, shop, { now: monday, origin: ORIGIN, provider });
    const notification = sent[0];
    if (notification?.kind !== "weekly_digest") throw new Error("no digest sent");
    const token = notification.turnOffUrl.split("/unsubscribe/")[1] ?? "";

    expect(await resolveWeeklyDigestUnsubscribeToken(db, token)).toMatchObject({
      personId: owner.personId,
      alreadyOff: false,
    });
    await turnOffWeeklyDigestByToken(db, { token });
    expect((await turnOffWeeklyDigestByToken(db, { token }))?.alreadyOff).toBe(true);
    expect((await listWeeklyDigestRecipients(db, shop.id)).map((r) => r.personId)).not.toContain(
      owner.personId,
    );
  });

  it("keeps its link working after the week's claim ages out (issue #3721)", async () => {
    const { db, shop, owner, monday } = await context();
    const { sent, provider } = capturingProvider();
    await sendWeeklyDigestForShop(db, shop, { now: monday, origin: ORIGIN, provider });
    const notification = sent[0];
    if (notification?.kind !== "weekly_digest") throw new Error("no digest sent");
    const token = notification.turnOffUrl.split("/unsubscribe/")[1] ?? "";
    // The retention prune deletes the claim; the link is not on it.
    await db.delete(weeklyDigestSends).where(eq(weeklyDigestSends.personId, owner.personId));

    expect(await turnOffWeeklyDigestByToken(db, { token })).toMatchObject({
      personId: owner.personId,
      alreadyOff: false,
    });
    expect(await resolveWeeklyDigestUnsubscribeToken(db, token)).toMatchObject({
      alreadyOff: true,
    });
  });

  it("mints one link per email sent, and none for a pass that found the week claimed", async () => {
    const { db, shop, owner, monday } = await context();
    const { provider } = capturingProvider();
    const mine = and(
      eq(capabilities.personId, owner.personId),
      eq(capabilities.purpose, "weekly_digest_unsubscribe"),
    );
    await sendWeeklyDigestForShop(db, shop, { now: monday, origin: ORIGIN, provider });
    expect(await db.select().from(capabilities).where(mine)).toHaveLength(1);
    await sendWeeklyDigestForShop(db, shop, { now: monday, origin: ORIGIN, provider });
    expect(await db.select().from(capabilities).where(mine)).toHaveLength(1);
  });

  it("refuses a link whose person is in another shop than the link's own", async () => {
    const { db, shop, owner, monday } = await context();
    const { sent, provider } = capturingProvider();
    await sendWeeklyDigestForShop(db, shop, { now: monday, origin: ORIGIN, provider });
    const notification = sent[0];
    if (notification?.kind !== "weekly_digest") throw new Error("no digest sent");
    const token = notification.turnOffUrl.split("/unsubscribe/")[1] ?? "";
    const [elsewhere] = await db
      .insert(shops)
      .values({ name: "Elsewhere", slug: "elsewhere-digest-link", timezone: "UTC" })
      .returning({ id: shops.id });
    if (!elsewhere) throw new Error("second shop insert failed");
    await db
      .update(capabilities)
      .set({ shopId: elsewhere.id })
      .where(eq(capabilities.personId, owner.personId));

    expect(await resolveWeeklyDigestUnsubscribeToken(db, token)).toBeNull();
    expect(await turnOffWeeklyDigestByToken(db, { token })).toBeNull();
  });

  it("reads a link sent to someone since deleted as unavailable", async () => {
    const { db, shop, owner, monday } = await context();
    const { sent, provider } = capturingProvider();
    await sendWeeklyDigestForShop(db, shop, { now: monday, origin: ORIGIN, provider });
    const notification = sent[0];
    if (notification?.kind !== "weekly_digest") throw new Error("no digest sent");
    const token = notification.turnOffUrl.split("/unsubscribe/")[1] ?? "";
    await db.update(people).set({ deletedAt: monday }).where(eq(people.id, owner.personId));

    expect(await resolveWeeklyDigestUnsubscribeToken(db, token)).toBeNull();
    expect(await turnOffWeeklyDigestByToken(db, { token })).toBeNull();
    const [account] = await db
      .select({ choice: userAccounts.weeklyDigest })
      .from(userAccounts)
      .where(eq(userAccounts.personId, owner.personId));
    expect(account?.choice).toBeNull();
  });

  it("reads an unknown or tampered link as unavailable", async () => {
    const { db } = await context();
    expect(await resolveWeeklyDigestUnsubscribeToken(db, "not-a-token")).toBeNull();
    expect(await turnOffWeeklyDigestByToken(db, { token: "not-a-token" })).toBeNull();
  });
});
