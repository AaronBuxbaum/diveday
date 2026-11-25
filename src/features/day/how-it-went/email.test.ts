import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { bookings, people, shops, trips, userAccounts } from "@/db/schema";
import { seedRollCallEvidence } from "@/db/seed/roll-call-evidence";
import { createTrip, listStaff } from "@/db/trips";
import { howItWentEmail } from "@/lib/notifications/how-it-went-email";
import type { Notification, NotificationProvider } from "@/lib/notifications/index";
import { fileScopedShopContext } from "@/test/db";
import { readHowItWentEmailChoice, sendDueHowItWentEmails, setHowItWentEmailChoice } from "./email";

/**
 * The owner's How it went email: once per counted departure, after the recap
 * is due, to owners who did not turn it off. Failure paths first: never early,
 * never twice, never for an uncounted, demo, rehearsal, cancelled or stale
 * departure, and a send that reached nobody gives its claim back.
 */
const ctx = fileScopedShopContext();
const ORIGIN = "https://diveday.example";
// Far from every seeded departure, so only this file's boats are in the window.
const NOW = new Date("2031-03-12T20:00:00Z");
const HOUR = 60 * 60 * 1000;

function recorder(status: "sent" | "failed" = "sent") {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      return status === "sent"
        ? { status: "sent", providerMessageId: `msg-${sent.length}` }
        : { status: "failed", retryable: false, errorCode: "test" };
    },
  };
  return { sent, provider };
}

async function departure(endedAgo: number, opts: { counted?: boolean } = {}) {
  const { db, shop } = ctx;
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
  const endsAt = new Date(NOW.getTime() - endedAgo);
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Two-Tank Reef",
    startsAt: new Date(endsAt.getTime() - 4 * HOUR),
    endsAt,
    capacity: 12,
    plannedDives: 1,
  });
  if (!trip) throw new Error("trip insert failed");
  const [staff] = await listStaff(db, shop.id);
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Ana Ruiz" })
    .returning();
  if (!staff || !person) throw new Error("fixture people missing");
  const [booking] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId: shop.id, tripId: trip.id, personId: person.id })
    .returning();
  if (!booking) throw new Error("booking insert failed");
  if (opts.counted !== false) {
    await seedRollCallEvidence(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
      checkpoint: "departure",
      occurredAt: new Date(endsAt.getTime() - 3 * HOUR),
    });
  }
  return { db, shop, trip };
}

const mine = (sent: Notification[], tripId: string) =>
  sent.filter((n) => n.kind === "how_it_went" && n.tripId === tripId);

describe("sendDueHowItWentEmails", () => {
  it("emails each owner once, linking the page, after the recap is due", async () => {
    const { db, shop, trip } = await departure(5 * HOUR);
    const { sent, provider } = recorder();
    const first = await sendDueHowItWentEmails(db, { now: NOW, origin: ORIGIN, provider });
    const ours = mine(sent, trip.id);
    expect(ours.length).toBeGreaterThan(0);
    expect(first.sent).toBe(1);
    for (const n of ours) {
      if (n.kind !== "how_it_went") continue;
      expect(n.pageUrl).toBe(`${ORIGIN}/shop/${shop.slug}/trips/${trip.id}/how-it-went`);
      expect(n.settingsUrl).toBe(`${ORIGIN}/shop/${shop.slug}/me/email`);
    }
    const again = recorder();
    await sendDueHowItWentEmails(db, {
      now: new Date(NOW.getTime() + HOUR),
      origin: ORIGIN,
      provider: again.provider,
    });
    expect(mine(again.sent, trip.id)).toEqual([]);
  });

  it("waits until four hours past the scheduled return", async () => {
    const { db, trip } = await departure(4 * HOUR);
    const { sent, provider } = recorder();
    await sendDueHowItWentEmails(db, { now: NOW, origin: ORIGIN, provider });
    expect(mine(sent, trip.id)).toEqual([]);
  });

  it("sends nothing for a departure nobody counted", async () => {
    const { db, trip } = await departure(5 * HOUR, { counted: false });
    const { sent, provider } = recorder();
    await sendDueHowItWentEmails(db, { now: NOW, origin: ORIGIN, provider });
    expect(mine(sent, trip.id)).toEqual([]);
  });

  it("sends nothing past the lookback, for a demo shop, a rehearsal or a cancelled departure", async () => {
    const { db, shop, trip } = await departure(60 * HOUR);
    const { sent, provider } = recorder();
    await sendDueHowItWentEmails(db, { now: NOW, origin: ORIGIN, provider });
    expect(mine(sent, trip.id)).toEqual([]);

    const rehearsal = await departure(5 * HOUR);
    await db
      .update(trips)
      .set({ isRehearsal: true, isPrivate: true })
      .where(eq(trips.id, rehearsal.trip.id));
    const cancelled = await departure(5 * HOUR);
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, cancelled.trip.id));
    await sendDueHowItWentEmails(db, { now: NOW, origin: ORIGIN, provider });
    expect(mine(sent, rehearsal.trip.id)).toEqual([]);
    expect(mine(sent, cancelled.trip.id)).toEqual([]);

    const demo = await departure(5 * HOUR);
    await db.update(shops).set({ isDemo: true }).where(eq(shops.id, shop.id));
    await sendDueHowItWentEmails(db, { now: NOW, origin: ORIGIN, provider });
    expect(mine(sent, demo.trip.id)).toEqual([]);
  });

  it("gives the claim back when no owner was reached, so the next pass tries again", async () => {
    const { db, trip } = await departure(5 * HOUR);
    const failing = recorder("failed");
    const first = await sendDueHowItWentEmails(db, {
      now: NOW,
      origin: ORIGIN,
      provider: failing.provider,
    });
    expect(first.released).toBe(1);
    const [row] = await db
      .select({ at: trips.howItWentSentAt })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(row?.at).toBeNull();
    const ok = recorder();
    await sendDueHowItWentEmails(db, {
      now: new Date(NOW.getTime() + HOUR),
      origin: ORIGIN,
      provider: ok.provider,
    });
    expect(mine(ok.sent, trip.id).length).toBeGreaterThan(0);
  });

  it("skips an owner who turned it off, and a staffer who is not an owner has no choice to make", async () => {
    const { db, shop, trip } = await departure(5 * HOUR);
    const staff = await listStaff(db, shop.id);
    const owner = staff.find((row) => row.roles.includes("owner"))?.person;
    const crew = staff.find((row) => !row.roles.includes("owner"))?.person;
    if (!owner || !crew) throw new Error("demo shop needs an owner and crew");
    expect(await readHowItWentEmailChoice(db, { shopId: shop.id, personId: owner.id })).toEqual({
      wanted: true,
      isDefault: true,
    });
    expect(await readHowItWentEmailChoice(db, { shopId: shop.id, personId: crew.id })).toBeNull();
    const owners = await db
      .select({ personId: userAccounts.personId })
      .from(userAccounts)
      .innerJoin(people, eq(people.id, userAccounts.personId))
      .where(eq(people.shopId, shop.id));
    for (const row of owners) {
      await setHowItWentEmailChoice(db, { shopId: shop.id, personId: row.personId, wanted: false });
    }
    expect(await readHowItWentEmailChoice(db, { shopId: shop.id, personId: owner.id })).toEqual({
      wanted: false,
      isDefault: false,
    });
    const { sent, provider } = recorder();
    const summary = await sendDueHowItWentEmails(db, { now: NOW, origin: ORIGIN, provider });
    expect(mine(sent, trip.id)).toEqual([]);
    // Nobody to send to takes no claim, so turning it back on still sends.
    expect(summary.released).toBe(0);
  });
});

describe("howItWentEmail", () => {
  it("names the departure and links the page, with no diver in it", () => {
    const email = howItWentEmail({
      locale: "en-US",
      recipientName: "Maya",
      shopName: "Reef Co",
      tripTitle: "Two-Tank <Reef>",
      startsAt: new Date("2031-03-08T13:00:00Z"),
      timezone: "America/New_York",
      pageUrl: "https://diveday.example/shop/reef/trips/1/how-it-went",
      settingsUrl: "https://diveday.example/shop/reef/me/email",
    });
    expect(email.subject).toContain("Saturday");
    expect(email.text).toContain("https://diveday.example/shop/reef/trips/1/how-it-went");
    expect(email.text).toContain("https://diveday.example/shop/reef/me/email");
    expect(email.html).not.toContain("<Reef>");
    expect(email.html).toContain("&lt;Reef&gt;");
  });

  it("speaks Spanish to a Spanish owner", () => {
    const email = howItWentEmail({
      locale: "es-ES",
      recipientName: "Maya",
      shopName: "Arrecife",
      tripTitle: "Dos inmersiones",
      startsAt: new Date("2031-03-08T13:00:00Z"),
      timezone: "America/New_York",
      pageUrl: "https://diveday.example/x",
      settingsUrl: "https://diveday.example/y",
    });
    expect(email.subject).toContain("cómo fue");
  });
});
