import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { notificationSchema } from "@/lib/notifications/kinds";
import { messageFor } from "@/lib/notifications/render";
import { NO_EMERGENCY_READS } from "@/lib/weekly-digest";
import { dbNow, fileScopedShopContext, type seededShopContext } from "@/test/db";
import { readOwed } from "./owed";
import {
  activityEvents,
  bookings,
  courses,
  interests,
  orders,
  paymentOperationIntents,
  people,
  shops,
  trips,
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
      expect(preview.preparedAt).toBe(monday.toISOString());
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
    await db.insert(interests).values([
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

  it("counts only course inquiries while date requests are switched off", async () => {
    const { db, shop, monday } = await context();
    const day = new Date(monday.getTime() + 10 * 24 * 3_600_000).toISOString().slice(0, 10);
    const waitingOf = async () =>
      (await readWeeklyDigestFacts(db, shop, monday)).grades.reports.dateRequestsWaiting;
    await db.update(shops).set({ dateRequestsEnabled: false }).where(eq(shops.id, shop.id));
    const before = await waitingOf();
    const [course] = await db
      .insert(courses)
      .values({
        shopId: shop.id,
        title: "Open Water",
        slug: "digest-open-water",
        agency: "PADI",
        certifiesLevel: "open_water",
      })
      .returning();
    if (!course) throw new Error("course not inserted");
    const ask = { shopId: shop.id, scope: "date" as const, askedBy: "diver" as const };
    await db.insert(interests).values([
      { ...ask, interest: "Night dive", name: "Day ask", preferredDate: day },
      { ...ask, courseId: course.id, name: "Course inquiry", preferredDate: day },
    ]);
    expect(await waitingOf()).toBe(before + 1);
  });

  it("suggests no boat for a deal while the last-minute list is switched off", async () => {
    const { db, shop, monday } = await context();
    await db.update(shops).set({ lastMinuteListEnabled: false }).where(eq(shops.id, shop.id));
    const facts = await readWeeklyDigestFacts(db, shop, monday);
    expect(facts.grades.reports.thisWeek.weakest).toBeNull();
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

/**
 * **Last week's emergency reads of a medical alert** (issue #2990): the
 * owner's Monday email lists each one (diver, departure, reader, when); the
 * crew's lists none, and a week without one names nothing.
 */
describe("the emergency reads in the Monday email", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  async function emergencyRead(
    db: Awaited<ReturnType<typeof context>>["db"],
    input: {
      shopId: string;
      actor: { id: string; name: string };
      diver: { id: string; name: string };
      departureId: string;
      at: Date;
      code?: "medical_alert_emergency_read" | "medical_alert_read";
    },
  ) {
    await db.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: null,
      bookingId: null,
      actorPersonId: input.actor.id,
      subjectPersonId: input.diver.id,
      code: input.code ?? "medical_alert_emergency_read",
      params: { actor: input.actor.name, diver: input.diver.name, departure: input.departureId },
      occurredAt: input.at,
    });
  }

  it("lists each of last week's reads for the owner, and none for the crew", async () => {
    const { db, shop, owner, captain, monday } = await context();
    const [departure] = await db
      .select({ id: trips.id, title: trips.title, startsAt: trips.startsAt })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(1);
    const [diver] = await db
      .select({ id: people.id, name: people.fullName })
      .from(people)
      .where(and(eq(people.shopId, shop.id), ne(people.id, owner.personId)))
      .limit(1);
    if (!departure || !diver) throw new Error("expected a seeded departure and diver");
    const actor = { id: captain.personId, name: "Sal Captain" };
    const lastWeek = new Date(monday.getTime() - 3 * DAY_MS);
    await emergencyRead(db, {
      shopId: shop.id,
      actor,
      diver,
      departureId: departure.id,
      at: lastWeek,
    });
    // A second read of the same alert a minute later is its own line.
    const minuteLater = new Date(lastWeek.getTime() + 60_000);
    await emergencyRead(db, {
      shopId: shop.id,
      actor,
      diver,
      departureId: departure.id,
      at: minuteLater,
    });
    // Not listed: two weeks ago, this week, an ordinary read, another shop.
    await emergencyRead(db, {
      shopId: shop.id,
      actor,
      diver,
      departureId: departure.id,
      at: new Date(monday.getTime() - 10 * DAY_MS),
    });
    await emergencyRead(db, {
      shopId: shop.id,
      actor,
      diver,
      departureId: departure.id,
      at: monday,
    });
    await emergencyRead(db, {
      shopId: shop.id,
      actor,
      diver,
      departureId: departure.id,
      at: lastWeek,
      code: "medical_alert_read",
    });
    const [elsewhere] = await db.select({ id: shops.id }).from(shops).where(ne(shops.id, shop.id));
    if (elsewhere) {
      const [stranger] = await db
        .select({ id: people.id, name: people.fullName })
        .from(people)
        .where(eq(people.shopId, elsewhere.id))
        .limit(1);
      if (stranger) {
        await emergencyRead(db, {
          shopId: elsewhere.id,
          actor: stranger,
          diver: stranger,
          departureId: departure.id,
          at: lastWeek,
        });
      }
    }

    const facts = await readWeeklyDigestFacts(db, shop, monday);
    const expected = {
      diver: diver.name,
      departureTitle: departure.title,
      departureStartsAt: departure.startsAt,
      reader: "Sal Captain",
    };
    expect(facts.grades.reports.emergencyReads).toEqual({
      total: 2,
      byReader: [{ reader: "Sal Captain", count: 2 }],
      listed: [
        { ...expected, at: lastWeek },
        { ...expected, at: minuteLater },
      ],
    });
    expect(facts.grades.staff.emergencyReads).toEqual(NO_EMERGENCY_READS);

    const sectionsFor = async (personId: string) => {
      const preview = await previewWeeklyDigest(db, {
        shop,
        personId,
        origin: ORIGIN,
        now: monday,
      });
      if (preview?.kind !== "weekly_digest") throw new Error("no preview");
      return preview.sections;
    };
    const ownerSection = (await sectionsFor(owner.personId)).find(
      (section) => section.kind === "emergency_reads",
    );
    expect(ownerSection).toMatchObject({
      kind: "emergency_reads",
      url: `${ORIGIN}/shop/${shop.slug}/divers`,
    });
    expect((await sectionsFor(captain.personId)).map((section) => section.kind)).not.toContain(
      "emergency_reads",
    );
  });

  it("counts every read past the 50 it lists, and says who opened how many", async () => {
    const { db, shop, owner, captain, monday } = await context();
    const [departure] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(1);
    const [diver] = await db
      .select({ id: people.id, name: people.fullName })
      .from(people)
      .where(and(eq(people.shopId, shop.id), ne(people.id, owner.personId)))
      .limit(1);
    if (!departure || !diver) throw new Error("expected a seeded departure and diver");
    const start = new Date(monday.getTime() - 5 * DAY_MS);
    // One staffer opens 60 alerts on a busy Saturday; another opens one.
    for (let read = 0; read < 60; read++) {
      await emergencyRead(db, {
        shopId: shop.id,
        actor: { id: captain.personId, name: "Sal Captain" },
        diver,
        departureId: departure.id,
        at: new Date(start.getTime() + read * 60_000),
      });
    }
    await emergencyRead(db, {
      shopId: shop.id,
      actor: { id: owner.personId, name: "Dana Owner" },
      diver,
      departureId: departure.id,
      at: new Date(start.getTime() + 3 * DAY_MS),
    });
    const facts = await readWeeklyDigestFacts(db, shop, monday);
    const reads = facts.grades.reports.emergencyReads;
    expect(reads.total).toBe(61);
    expect(reads.listed).toHaveLength(50);
    expect(reads.byReader).toEqual([
      { reader: "Sal Captain", count: 60 },
      { reader: "Dana Owner", count: 1 },
    ]);
    const preview = await previewWeeklyDigest(db, {
      shop,
      personId: owner.personId,
      origin: ORIGIN,
      now: monday,
    });
    if (preview?.kind !== "weekly_digest") throw new Error("no preview");
    expect(preview.sections.find((section) => section.kind === "emergency_reads")).toMatchObject({
      total: 61,
    });
  });

  it("keeps a line whose names are blank, and the email still validates", async () => {
    const { db, shop, owner, monday } = await context();
    const [departure] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(1);
    if (!departure) throw new Error("expected a seeded departure");
    await db.insert(activityEvents).values({
      shopId: shop.id,
      actorPersonId: owner.personId,
      code: "medical_alert_emergency_read",
      // No diver, a blank reader: a writer that forgot them.
      params: { actor: "  ", departure: departure.id },
      occurredAt: new Date(monday.getTime() - 2 * DAY_MS),
    });
    const facts = await readWeeklyDigestFacts(db, shop, monday);
    expect(facts.grades.reports.emergencyReads).toMatchObject({
      total: 1,
      byReader: [{ reader: null, count: 1 }],
      listed: [{ diver: null, reader: null }],
    });
    const preview = await previewWeeklyDigest(db, {
      shop,
      personId: owner.personId,
      origin: ORIGIN,
      now: monday,
    });
    if (preview?.kind !== "weekly_digest") throw new Error("the email failed to build");
    expect(preview.sections.map((section) => section.kind)).toContain("emergency_reads");
    // The schema every send validates against takes it, and the text names a stand-in.
    const { text } = messageFor(notificationSchema.parse(preview));
    expect(text).toContain("a staffer opened a diver’s medical alert");
  });

  it("names nothing in a week with no emergency read", async () => {
    const { db, shop, owner, monday } = await context();
    const facts = await readWeeklyDigestFacts(db, shop, monday);
    expect(facts.grades.reports.emergencyReads).toEqual(NO_EMERGENCY_READS);
    const preview = await previewWeeklyDigest(db, {
      shop,
      personId: owner.personId,
      origin: ORIGIN,
      now: monday,
    });
    if (preview?.kind === "weekly_digest") {
      expect(preview.sections.map((section) => section.kind)).not.toContain("emergency_reads");
    }
  });
});
