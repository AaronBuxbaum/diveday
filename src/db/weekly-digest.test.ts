import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { messageFor } from "@/lib/notifications/render";
import { dbNow, seededShopContext } from "@/test/db";
import { people, shops, userAccounts, weeklyDigestSends } from "./schema";
import {
  listWeeklyDigestRecipients,
  previewWeeklyDigest,
  readWeeklyDigestChoice,
  resolveWeeklyDigestUnsubscribeToken,
  sendDueWeeklyDigests,
  sendWeeklyDigestForShop,
  setWeeklyDigestChoice,
  turnOffWeeklyDigestByToken,
  type WeeklyDigestShop,
} from "./weekly-digest";

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
  const { db, shop } = await seededShopContext();
  const digestShop: WeeklyDigestShop = {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    timezone: shop.timezone,
    defaultLocale: shop.defaultLocale,
    diversPerDivemaster: shop.diversPerDivemaster,
  };
  const staff = await db
    .select({ personId: people.id, email: userAccounts.email })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .where(eq(people.shopId, shop.id));
  const owner = staff.find((row) => row.email === "dana@demo.invalid");
  const instructor = staff.find((row) => row.email === "marcus@demo.invalid");
  if (!owner || !instructor) throw new Error("seeded staff missing");
  return { db, shop: digestShop, owner, instructor, monday: await nextMondayMorning(db) };
}

describe("who gets the Monday email", () => {
  it("sends to the owner by default and to nobody else", async () => {
    const { db, shop, owner, instructor } = await context();
    const recipients = (await listWeeklyDigestRecipients(db, shop.id)).map((r) => r.personId);
    expect(recipients).toContain(owner.personId);
    expect(recipients).not.toContain(instructor.personId);
  });

  it("honours each person's own answer over their role's default", async () => {
    const { db, shop, owner, instructor } = await context();
    await setWeeklyDigestChoice(db, { shopId: shop.id, personId: owner.personId, wanted: false });
    await setWeeklyDigestChoice(db, {
      shopId: shop.id,
      personId: instructor.personId,
      wanted: true,
    });
    const recipients = (await listWeeklyDigestRecipients(db, shop.id)).map((r) => r.personId);
    expect(recipients).not.toContain(owner.personId);
    expect(recipients).toContain(instructor.personId);
    expect(
      await readWeeklyDigestChoice(db, { shopId: shop.id, personId: instructor.personId }),
    ).toEqual({ wanted: true, isDefault: false });
  });

  it("never writes another shop's account", async () => {
    const { db, owner } = await context();
    const [other] = await db
      .insert(shops)
      .values({ name: "Elsewhere", slug: "elsewhere-digest", timezone: "UTC" })
      .returning();
    expect(
      await setWeeklyDigestChoice(db, {
        shopId: other.id,
        personId: owner.personId,
        wanted: false,
      }),
    ).toBe(false);
    const [account] = await db
      .select({ choice: userAccounts.weeklyDigest })
      .from(userAccounts)
      .where(eq(userAccounts.personId, owner.personId));
    expect(account?.choice).toBeNull();
  });
});

describe("sendWeeklyDigestForShop", () => {
  it("sends once per person per week, however many passes run", async () => {
    const { db, shop, owner, monday } = await context();
    const { sent, provider } = capturingProvider();

    const first = await sendWeeklyDigestForShop(db, shop, {
      now: monday,
      origin: ORIGIN,
      provider,
    });
    expect(first.sent).toBe(1);
    expect(sent).toHaveLength(1);
    const later = new Date(monday.getTime() + 3 * 3_600_000);
    const second = await sendWeeklyDigestForShop(db, shop, {
      now: later,
      origin: ORIGIN,
      provider,
    });
    expect(second).toMatchObject({ sent: 0, alreadySent: 1 });
    expect(sent).toHaveLength(1);

    const claims = await db
      .select()
      .from(weeklyDigestSends)
      .where(eq(weeklyDigestSends.personId, owner.personId));
    expect(claims).toHaveLength(1);
    expect(claims[0]?.status).toBe("sent");
  });

  it("writes an email whose every link opens the staff app and whose way out works", async () => {
    const { db, shop, monday } = await context();
    const { sent, provider } = capturingProvider();
    await sendWeeklyDigestForShop(db, shop, { now: monday, origin: ORIGIN, provider });
    const notification = sent[0];
    if (notification?.kind !== "weekly_digest") throw new Error("no digest sent");

    expect(notification.sections.length).toBeGreaterThan(0);
    for (const section of notification.sections) {
      expect(section.url.startsWith(`${ORIGIN}/shop/${shop.slug}`)).toBe(true);
    }
    expect(notification.settingsUrl).toBe(`${ORIGIN}/shop/${shop.slug}/settings/email`);
    expect(notification.turnOffUrl).toMatch(/^https:\/\/diveday\.example\/unsubscribe\/.+/);
    const rendered = messageFor(notification);
    expect(rendered.subject).toContain(shop.name);
    expect(rendered.html).toContain(notification.turnOffUrl);
    // Service mail: no commercial postal footer, whatever the shop has on file.
    expect(rendered.text).not.toContain(" · ");
  });

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

  it("reads an unknown or tampered link as unavailable", async () => {
    const { db } = await context();
    expect(await resolveWeeklyDigestUnsubscribeToken(db, "not-a-token")).toBeNull();
    expect(await turnOffWeeklyDigestByToken(db, { token: "not-a-token" })).toBeNull();
  });

  it("records a provider that is not configured without sending twice", async () => {
    const { db, shop, owner, monday } = await context();
    const provider: NotificationProvider = { send: async () => ({ status: "not_configured" }) };
    const result = await sendWeeklyDigestForShop(db, shop, {
      now: monday,
      origin: ORIGIN,
      provider,
    });
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    const [claim] = await db
      .select({ status: weeklyDigestSends.status })
      .from(weeklyDigestSends)
      .where(eq(weeklyDigestSends.personId, owner.personId));
    expect(claim?.status).toBe("not_configured");
  });
});

describe("sendDueWeeklyDigests", () => {
  it("never sends for a demo shop", async () => {
    const { db, shop, monday } = await context();
    const { sent, provider } = capturingProvider();
    await sendDueWeeklyDigests(db, { now: monday, origin: ORIGIN, provider });
    expect(sent.filter((n) => "shopId" in n && n.shopId === shop.id)).toHaveLength(0);
    const claims = await db
      .select()
      .from(weeklyDigestSends)
      .where(eq(weeklyDigestSends.shopId, shop.id));
    expect(claims).toHaveLength(0);
  });

  it("sends for a real shop on its Monday morning, and not on Tuesday", async () => {
    const { db, shop, monday } = await context();
    await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
    const { sent, provider } = capturingProvider();

    const tuesday = new Date(monday.getTime() + 24 * 3_600_000);
    expect(
      (await sendDueWeeklyDigests(db, { now: tuesday, origin: ORIGIN, provider })).shopsDue,
    ).toBe(0);
    const summary = await sendDueWeeklyDigests(db, { now: monday, origin: ORIGIN, provider });
    expect(summary.shopsDue).toBeGreaterThanOrEqual(1);
    expect(sent.filter((n) => n.kind === "weekly_digest" && n.shopId === shop.id)).toHaveLength(1);
  });

  it("sends nothing without a public origin to link to", async () => {
    const { db, shop, monday } = await context();
    await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
    const { sent, provider } = capturingProvider();
    const summary = await sendDueWeeklyDigests(db, { now: monday, origin: null, provider });
    expect(summary.shopsDue).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe("previewWeeklyDigest", () => {
  it("builds this staffer's email without claiming the week or minting a link", async () => {
    const { db, shop, instructor, monday } = await context();
    const preview = await previewWeeklyDigest(db, {
      shop,
      personId: instructor.personId,
      origin: ORIGIN,
      now: monday,
    });
    expect(preview?.kind).toBe("weekly_digest");
    if (preview?.kind === "weekly_digest") {
      expect(preview.turnOffUrl).toBe(`${ORIGIN}/shop/${shop.slug}/settings/email`);
    }
    const claims = await db
      .select()
      .from(weeklyDigestSends)
      .where(
        and(
          eq(weeklyDigestSends.shopId, shop.id),
          eq(weeklyDigestSends.personId, instructor.personId),
        ),
      );
    expect(claims).toHaveLength(0);
  });

  it("previews nothing for somebody who is not staff here", async () => {
    const { db, shop, monday } = await context();
    expect(
      await previewWeeklyDigest(db, {
        shop,
        personId: "00000000-0000-0000-0000-000000000000",
        origin: ORIGIN,
        now: monday,
      }),
    ).toBeNull();
  });
});
