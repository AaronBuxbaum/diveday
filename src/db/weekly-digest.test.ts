import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { messageFor } from "@/lib/notifications/render";
import { dbNow, fileScopedShopContext, type seededShopContext } from "@/test/db";
import { readOwed } from "./owed";
import {
  bookings,
  leads,
  orders,
  paymentOperationIntents,
  people,
  shops,
  userAccounts,
  weeklyDigestSends,
} from "./schema";
import {
  listWeeklyDigestRecipients,
  previewWeeklyDigest,
  readWeeklyDigestChoice,
  readWeeklyDigestFacts,
  resolveWeeklyDigestUnsubscribeToken,
  sendDueWeeklyDigests,
  sendWeeklyDigestForShop,
  setWeeklyDigestChoice,
  turnOffWeeklyDigestByToken,
  type WeeklyDigestShop,
} from "./weekly-digest";

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

  it("gives a crew member who opted in the staff-grade week", async () => {
    const { db, shop, captain, monday } = await context();
    await setWeeklyDigestChoice(db, { shopId: shop.id, personId: captain.personId, wanted: true });
    const { sent, provider } = capturingProvider();
    await sendWeeklyDigestForShop(db, shop, { now: monday, origin: ORIGIN, provider });
    const theirs = sent.find((n) => n.kind === "weekly_digest" && n.personId === captain.personId);
    if (theirs?.kind !== "weekly_digest") throw new Error("no digest for the captain");
    expect(theirs.sections.map((section) => section.kind)).not.toContain("last_week");
    expect(messageFor(theirs).text).not.toContain("/reports");
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
  it("never asks the marine forecast provider for anything (#2489)", async () => {
    const { db, shop, owner } = await context();
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));
    try {
      await previewWeeklyDigest(db, {
        shop,
        personId: owner.personId,
        origin: ORIGIN,
        // Today's own clock: the seeded departures sit inside the provider's window.
        now: nowDate(),
      });
      // The request, if one went out, starts a tick after the queue returns.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });

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

  /**
   * Reports' gate decides two things in the email (security review): last
   * week's bookings and seat fill, and the money and platform chores Today
   * only shows that gate's holders. A crew member's preview carries neither;
   * the owner's carries both.
   */
  it("keeps Reports-grade facts out of a crew member's email", async () => {
    const { db, shop, owner, captain, instructor, monday } = await context();
    // A stuck Stripe call: an ops alert on Today for an owner or manager only.
    await db.insert(paymentOperationIntents).values({
      shopId: shop.id,
      kind: "refund",
      startedAt: new Date(monday.getTime() - 2 * 24 * 3_600_000),
    });
    // A booking made last week, so the owner's email has a last week to report.
    const [booking] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.shopId, shop.id), ne(bookings.status, "cancelled")))
      .limit(1);
    if (!booking) throw new Error("seeded booking missing");
    await db
      .update(bookings)
      .set({ createdAt: new Date(monday.getTime() - 3 * 24 * 3_600_000) })
      .where(eq(bookings.id, booking.id));
    const previewFor = async (personId: string) => {
      const preview = await previewWeeklyDigest(db, {
        shop,
        personId,
        origin: ORIGIN,
        now: monday,
      });
      if (preview?.kind !== "weekly_digest") throw new Error("no preview");
      return preview;
    };
    const overdueOf = (preview: Awaited<ReturnType<typeof previewFor>>) => {
      const section = preview.sections.find((s) => s.kind === "overdue");
      return section?.kind === "overdue" ? section.count : 0;
    };

    const ownerPreview = await previewFor(owner.personId);
    expect(ownerPreview.sections.map((section) => section.kind)).toContain("last_week");
    expect(messageFor(ownerPreview).text).toContain(`${ORIGIN}/shop/${shop.slug}/reports`);

    for (const crew of [captain, instructor]) {
      const crewPreview = await previewFor(crew.personId);
      const kinds = crewPreview.sections.map((section) => section.kind);
      expect(kinds).not.toContain("last_week");
      const { text } = messageFor(crewPreview);
      expect(text).not.toMatch(/sailed with/);
      expect(text).not.toContain("/reports");
      // The owner's overdue count is the crew's plus the stuck Stripe call.
      expect(overdueOf(ownerPreview)).toBe(overdueOf(crewPreview) + 1);
    }
  });

  /**
   * **What the week made, by role** (third UX review, item 33; decision 5).
   * The owner's email says what last week's departures took and how many
   * orders are open, Reports' own figures; a crew member's never carries a
   * dollar or the Orders link.
   */
  it("gives the owner the week's money and the crew none of it", async () => {
    const { db, shop, owner, captain, monday } = await context();
    const previewFor = async (personId: string) => {
      const preview = await previewWeeklyDigest(db, {
        shop,
        personId,
        origin: ORIGIN,
        now: monday,
      });
      if (preview?.kind !== "weekly_digest") throw new Error("no preview");
      return preview;
    };
    // One invoice still waiting on the diver, so the owner has money to hear about.
    await db.insert(orders).values({
      shopId: shop.id,
      personId: owner.personId,
      createdByPersonId: owner.personId,
      status: "open",
      currency: shop.currency,
      totalCents: 9_500,
      stripeAccountId: "acct_digest",
      stripeCustomerId: "cus_digest",
      stripeInvoiceId: "in_digest_open",
    });
    const owed = await readOwed(db, shop, monday);

    const ownerPreview = await previewFor(owner.personId);
    const money = ownerPreview.sections.find((section) => section.kind === "money");
    expect(money?.kind).toBe("money");
    if (money?.kind === "money") {
      expect(money.owed.orderCount).toBe(owed.orders.count);
      expect(money.owed.orderCents).toBe(owed.orders.cents);
      expect(money.owed.seatCents).toBe(owed.seats.cents);
      expect(money.currency).toBe(shop.currency);
      expect(money.url).toBe(`${ORIGIN}/shop/${shop.slug}/orders`);
    }

    const crewPreview = await previewFor(captain.personId);
    expect(crewPreview.sections.map((section) => section.kind)).not.toContain("money");
    expect(messageFor(crewPreview).text).not.toContain("/orders");
  });

  /**
   * **A request marked done is not waiting** (fourth UX review, item 24): the
   * digest filters on `closedAt` like every staff reader of requests.
   */
  it("counts only the date requests nobody has marked done", async () => {
    const { db, shop, monday } = await context();
    const day = new Date(monday.getTime() + 10 * 24 * 3_600_000).toISOString().slice(0, 10);
    const waitingOf = async () =>
      (await readWeeklyDigestFacts(db, shop, monday)).grades.reports.dateRequestsWaiting;
    const before = await waitingOf();
    await db.insert(leads).values([
      {
        shopId: shop.id,
        scope: "date",
        askedBy: "diver",
        interest: "Night dive",
        name: "Waiting",
        preferredDate: day,
      },
      {
        shopId: shop.id,
        scope: "date",
        askedBy: "diver",
        interest: "Night dive",
        name: "Done",
        preferredDate: day,
        closedAt: monday,
        closedAs: "done",
      },
    ]);
    expect(await waitingOf()).toBe(before + 1);
  });

  it("gives the owner the gear line and the safety sentence, and the crew neither", async () => {
    const { db, shop, owner, captain, monday } = await context();
    const facts = await readWeeklyDigestFacts(db, shop, monday);
    expect(facts.grades.staff.gearServiceDue).toBe(0);
    expect(facts.grades.staff.safety).toEqual({ openRollCalls: 0, uncrewed: 0, incidents: 0 });
    const kindsFor = async (personId: string) => {
      const preview = await previewWeeklyDigest(db, {
        shop,
        personId,
        origin: ORIGIN,
        now: monday,
      });
      if (preview?.kind !== "weekly_digest") throw new Error("no preview");
      return preview.sections.map((section) => section.kind);
    };
    const crewKinds = await kindsFor(captain.personId);
    expect(crewKinds).not.toContain("safety");
    expect(crewKinds).not.toContain("gear_service");
    const ownerKinds = await kindsFor(owner.personId);
    expect(ownerKinds.includes("gear_service")).toBe(facts.grades.reports.gearServiceDue > 0);
  });

  /**
   * **The boat worth a deal, and last year's week** (fifth loop, item 29):
   * both are money calls, so the owner reads them and the crew does not.
   */
  it("names the week's emptiest boat for the owner only, linked to its deal form", async () => {
    const { db, shop, owner, captain, monday } = await context();
    const facts = await readWeeklyDigestFacts(db, shop, monday);
    expect(facts.grades.staff.thisWeek.weakest).toBeNull();
    expect(facts.grades.staff.money.lastYearRevenueCents).toBeNull();
    const weakest = facts.grades.reports.thisWeek.weakest;
    if (weakest) {
      expect(weakest.booked * 2).toBeLessThan(weakest.capacity);
      expect(weakest.startsAt.getTime()).toBeGreaterThan(monday.getTime());
    }
    const thisWeekOf = async (personId: string) => {
      const preview = await previewWeeklyDigest(db, {
        shop,
        personId,
        origin: ORIGIN,
        now: monday,
      });
      if (preview?.kind !== "weekly_digest") throw new Error("no preview");
      return preview.sections.find((section) => section.kind === "this_week");
    };
    const ownerWeek = await thisWeekOf(owner.personId);
    if (weakest && ownerWeek?.kind === "this_week") {
      expect(ownerWeek.weakest?.url).toBe(
        `${ORIGIN}/shop/${shop.slug}/trips/${weakest.tripId}?view=details#last-minute-deal`,
      );
    }
    const crewWeek = await thisWeekOf(captain.personId);
    if (crewWeek?.kind === "this_week") expect(crewWeek.weakest).toBeNull();
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
