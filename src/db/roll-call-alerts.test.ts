import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { sendStaleRollCallAlerts } from "./roll-call-alerts";

// The push half of the send path, made to throw on demand: the email half
// reports a provider failure as a status, so a throw there is the database's.
const pushFault = vi.hoisted(() => ({ throws: false }));
vi.mock("./push-subscriptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./push-subscriptions")>();
  return {
    ...actual,
    pushTripAlert: async (...args: Parameters<typeof actual.pushTripAlert>) => {
      if (pushFault.throws) throw new Error("push exploded");
      return actual.pushTripAlert(...args);
    },
  };
});
afterEach(() => {
  pushFault.throws = false;
});

import {
  bookings,
  people,
  personRoles,
  rollCallCrewEvents,
  rollCallEvents,
  shopShoreAlertTokens,
  shops,
  tripAssignments,
  trips,
  userAccounts,
} from "./schema";
import { setShopShoreAlertContact } from "./shops";
import { resolveShoreAlertStopToken } from "./shore-alert-tokens";
import { createTrip, listStaff } from "./trips";

/**
 * Batch 6, item 6: an after-dive roll call still open half an hour after the
 * boat was due back tells the owners, once per departure. Failure paths first:
 * the alert must never fire on a closed count, a boat not yet due, a demo, a
 * rehearsal, or twice.
 */
const ctx = fileScopedShopContext();
const ORIGIN = "https://diveday.example";
// Far from every seeded departure, so only this file's boats are in the window.
const NOW = new Date("2031-03-12T20:00:00Z");
const HOUR = 60 * 60 * 1000;

function recorder(status: "sent" | "failed" = "sent", onlyTo?: string) {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      const delivers = onlyTo === undefined ? status === "sent" : notification.to === onlyTo;
      return delivers
        ? { status: "sent", providerMessageId: `msg-${sent.length}` }
        : { status: "failed", retryable: false, errorCode: "test" };
    },
  };
  return { sent, provider };
}

/** A real (not demo) shop and a one-dive departure that ended `endedAgo` before NOW. */
async function departure(endedAgo: number, opts: { rehearsal?: boolean; title?: string } = {}) {
  const { db, shop } = ctx;
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
  const endsAt = new Date(NOW.getTime() - endedAgo);
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: opts.title ?? "Two-Tank Reef",
    startsAt: new Date(endsAt.getTime() - 4 * HOUR),
    endsAt,
    capacity: 12,
    plannedDives: 1,
  });
  if (!trip) throw new Error("trip insert failed");
  if (opts.rehearsal) {
    await db.update(trips).set({ isRehearsal: true, isPrivate: true }).where(eq(trips.id, trip.id));
  }
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
  const mark = async (checkpoint: string, status: "boarded" | "not_boarded") =>
    db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      recordedByPersonId: staff.person.id,
      status,
      checkpoint,
      occurredAt: new Date(endsAt.getTime() - HOUR),
    });
  await mark("departure", "boarded");
  return { db, shop, trip, mark };
}

async function ownerEmails() {
  const { db, shop } = ctx;
  const owners = await db
    .select({ personId: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), inArray(personRoles.role, ["owner"])));
  return new Set(owners.map((owner) => owner.personId));
}

describe("sendStaleRollCallAlerts", () => {
  it("emails the owners once about a count still open after the boat was due back", async () => {
    const { db, trip } = await departure(2 * HOUR);
    const { sent, provider } = recorder();
    const summary = await sendStaleRollCallAlerts(db, { now: NOW, origin: ORIGIN, provider });
    expect(summary).toMatchObject({ alerted: 1, released: 0 });
    expect(sent.length).toBeGreaterThan(0);
    const owners = await ownerEmails();
    for (const notification of sent) {
      if (notification.kind !== "roll_call_stale") throw new Error("wrong kind");
      expect(owners.has(notification.personId)).toBe(true);
      expect(notification).toMatchObject({
        tripId: trip.id,
        diveNumber: 1,
        notBackAboard: 0,
        awaiting: 1,
      });
      expect(notification.rollCallUrl).toBe(
        `${ORIGIN}/shop/${ctx.shop.slug}/trips/${trip.id}/manifest?checkpoint=after_dive_1`,
      );
      // A count and a link: nobody unaccounted for is named.
      expect(JSON.stringify(notification)).not.toContain("Ana Ruiz");
    }
    const [row] = await db
      .select({ alertedAt: trips.rollCallAlertedAt })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(row?.alertedAt).toEqual(NOW);

    // Once per departure, however many passes still see it open.
    const again = recorder();
    const later = new Date(NOW.getTime() + HOUR);
    await sendStaleRollCallAlerts(db, { now: later, origin: ORIGIN, provider: again.provider });
    expect(again.sent).toEqual([]);
  });

  it("says a stated missing person as missing", async () => {
    const { db, mark } = await departure(2 * HOUR);
    await mark("after_dive_1", "not_boarded");
    const { sent, provider } = recorder();
    await sendStaleRollCallAlerts(db, { now: NOW, origin: ORIGIN, provider });
    expect(sent[0]).toMatchObject({ kind: "roll_call_stale", notBackAboard: 1, awaiting: 0 });
  });

  // EAP review on H-20261014-stale-roll-call-recipients: the alert counted one row and said its one number.
  // One diver recorded not back aboard, another and a divemaster with no
  // result: "1 recorded not back aboard; 2 more have no result yet".
  it("sums diver and crew rows, and keeps the two counts apart", async () => {
    const { db, shop, trip, mark } = await departure(2 * HOUR);
    await mark("after_dive_1", "not_boarded");
    const [second] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Bea Soto" })
      .returning();
    const [staff, crewMember] = await listStaff(db, shop.id);
    if (!second || !staff || !crewMember) throw new Error("fixture people missing");
    const [seat] = await db
      .insert(bookings)
      .values({ bookedAs: "diver", shopId: shop.id, tripId: trip.id, personId: second.id })
      .returning();
    if (!seat) throw new Error("booking insert failed");
    const boardedAt = new Date(trip.endsAt.getTime() - 3 * HOUR);
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      bookingId: seat.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
      checkpoint: "departure",
      occurredAt: boardedAt,
    });
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: crewMember.person.id });
    await db.insert(rollCallCrewEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      personId: crewMember.person.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
      checkpoint: "departure",
      occurredAt: boardedAt,
    });
    const { sent, provider } = recorder();
    await sendStaleRollCallAlerts(db, { now: NOW, origin: ORIGIN, provider });
    const owners = sent.filter((notification) => notification.kind === "roll_call_stale");
    expect(owners.length).toBeGreaterThan(0);
    for (const notification of owners) {
      expect(notification).toMatchObject({ diveNumber: 1, notBackAboard: 1, awaiting: 2 });
    }
  });

  it("stays quiet once everyone is counted back aboard", async () => {
    const { db, mark } = await departure(2 * HOUR);
    await mark("after_dive_1", "boarded");
    const { sent, provider } = recorder();
    expect(await sendStaleRollCallAlerts(db, { now: NOW, origin: ORIGIN, provider })).toMatchObject(
      { alerted: 0 },
    );
    expect(sent).toEqual([]);
  });

  it("waits for half an hour past the end, and leaves yesterday's boats to Today", async () => {
    const soon = await departure(20 * 60 * 1000, { title: "Just back" });
    const old = await departure(30 * HOUR, { title: "Yesterday" });
    const { sent, provider } = recorder();
    await sendStaleRollCallAlerts(soon.db, { now: NOW, origin: ORIGIN, provider });
    expect(sent).toEqual([]);
    const rows = await soon.db
      .select({ alertedAt: trips.rollCallAlertedAt })
      .from(trips)
      .where(inArray(trips.id, [soon.trip.id, old.trip.id]));
    expect(rows.every((row) => row.alertedAt === null)).toBe(true);
  });

  it("never alerts about a rehearsal, or from a demo shop", async () => {
    const rehearsal = await departure(2 * HOUR, { rehearsal: true });
    const first = recorder();
    await sendStaleRollCallAlerts(rehearsal.db, {
      now: NOW,
      origin: ORIGIN,
      provider: first.provider,
    });
    expect(first.sent).toEqual([]);

    const real = await departure(2 * HOUR, { title: "Demo boat" });
    await real.db.update(shops).set({ isDemo: true }).where(eq(shops.id, real.shop.id));
    const second = recorder();
    await sendStaleRollCallAlerts(real.db, { now: NOW, origin: ORIGIN, provider: second.provider });
    expect(second.sent).toEqual([]);
  });

  it("clips a title longer than the kind holds, and still sends (security review 20261014)", async () => {
    const { db } = await departure(2 * HOUR, { title: `Reef ${"x".repeat(400)}` });
    const { sent, provider } = recorder();
    expect(await sendStaleRollCallAlerts(db, { now: NOW, origin: ORIGIN, provider })).toMatchObject(
      { alerted: 1 },
    );
    const [first] = sent;
    if (first?.kind !== "roll_call_stale") throw new Error("expected the alert");
    expect(first.tripTitle.length).toBeLessThanOrEqual(200);
    expect(first.tripTitle.endsWith("…")).toBe(true);
  });

  it("carries when the boat was due back", async () => {
    const { db, trip } = await departure(2 * HOUR);
    const { sent, provider } = recorder();
    await sendStaleRollCallAlerts(db, { now: NOW, origin: ORIGIN, provider });
    expect(sent[0]).toMatchObject({ endsAt: trip.endsAt, timezone: ctx.shop.timezone });
  });

  it("gives the claim back when the send path throws, and the next pass tries again", async () => {
    const { db, trip } = await departure(2 * HOUR);
    pushFault.throws = true;
    await expect(
      sendStaleRollCallAlerts(db, {
        now: NOW,
        origin: ORIGIN,
        provider: recorder("failed").provider,
      }),
    ).rejects.toThrow("push exploded");
    pushFault.throws = false;
    const [row] = await db
      .select({ alertedAt: trips.rollCallAlertedAt })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(row?.alertedAt).toBeNull();

    const retry = recorder();
    const later = new Date(NOW.getTime() + HOUR);
    expect(
      await sendStaleRollCallAlerts(db, { now: later, origin: ORIGIN, provider: retry.provider }),
    ).toMatchObject({ alerted: 1 });
  });

  it("gives the claim back when it reached nobody, so the next pass tries again", async () => {
    const { db, trip } = await departure(2 * HOUR);
    const failing = recorder("failed");
    const summary = await sendStaleRollCallAlerts(db, {
      now: NOW,
      origin: ORIGIN,
      provider: failing.provider,
    });
    expect(summary).toMatchObject({ alerted: 0, released: 1 });
    const [row] = await db
      .select({ alertedAt: trips.rollCallAlertedAt })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(row?.alertedAt).toBeNull();
  });

  describe("the shore contact (H-20261014-stale-roll-call-recipients)", () => {
    const SHORE = "shore@example.com";
    async function consentedShore(confirmed = true) {
      const [staff] = await listStaff(ctx.db, ctx.shop.id);
      if (!staff) throw new Error("fixture staff missing");
      await setShopShoreAlertContact(ctx.db, ctx.shop.id, {
        email: SHORE,
        consentAt: new Date(NOW.getTime() - 48 * HOUR),
        consentByPersonId: staff.person.id,
        confirmedAt: confirmed ? new Date(NOW.getTime() - 47 * HOUR) : null,
      });
    }
    const toShore = (sent: Notification[]) =>
      sent.filter((notification) => notification.kind === "roll_call_stale_shore");
    const claims = async (tripId: string) => {
      const [row] = await ctx.db
        .select({ owners: trips.rollCallAlertedAt, shore: trips.rollCallShoreAlertedAt })
        .from(trips)
        .where(eq(trips.id, tripId));
      return row;
    };

    it("emails a confirmed shore contact once, with a stop link and nobody named", async () => {
      await consentedShore();
      await ctx.db
        .update(shops)
        .set({ contactPhone: "+1 305 555 0100" })
        .where(eq(shops.id, ctx.shop.id));
      const { db, trip } = await departure(2 * HOUR);
      const { sent, provider } = recorder();
      const summary = await sendStaleRollCallAlerts(db, { now: NOW, origin: ORIGIN, provider });
      expect(summary).toMatchObject({ alerted: 1, shoreEmails: 1 });
      const shore = toShore(sent);
      expect(shore).toHaveLength(1);
      const [message] = shore;
      if (message?.kind !== "roll_call_stale_shore") throw new Error("expected the shore alert");
      expect(message).toMatchObject({
        to: SHORE,
        tripId: trip.id,
        diveNumber: 1,
        notBackAboard: 0,
        awaiting: 1,
        shopName: ctx.shop.name,
        shopPhone: "+1 305 555 0100",
        locale: ctx.shop.defaultLocale,
        alertedAt: NOW,
      });
      const payload = JSON.stringify(message);
      expect(payload).not.toContain("Ana Ruiz");
      expect(payload).not.toContain("/shop/");
      expect(payload).not.toContain("personId");
      // The one link stops these alerts, and resolves to this shop.
      expect(message.stopUrl.startsWith(`${ORIGIN}/unsubscribe/`)).toBe(true);
      const token = message.stopUrl.slice(`${ORIGIN}/unsubscribe/`.length);
      expect(await resolveShoreAlertStopToken(db, token)).toMatchObject({
        shopId: ctx.shop.id,
        alreadyStopped: false,
      });
      // The owners still hear, as before.
      expect(sent.some((notification) => notification.kind === "roll_call_stale")).toBe(true);
      expect(await claims(trip.id)).toEqual({ owners: NOW, shore: NOW });

      const again = recorder();
      await sendStaleRollCallAlerts(db, {
        now: new Date(NOW.getTime() + HOUR),
        origin: ORIGIN,
        provider: again.provider,
      });
      expect(again.sent).toEqual([]);
    });

    it("sends nothing ashore when the shop has no shore contact", async () => {
      const { db } = await departure(2 * HOUR);
      const { sent, provider } = recorder();
      expect(
        await sendStaleRollCallAlerts(db, { now: NOW, origin: ORIGIN, provider }),
      ).toMatchObject({ alerted: 1, shoreEmails: 0 });
      expect(toShore(sent)).toEqual([]);
    });

    // Security review on H-20261014-stale-roll-call-recipients: nothing goes to an address its inbox has not confirmed.
    it("sends nothing to an address its inbox has not confirmed", async () => {
      await consentedShore(false);
      const { db } = await departure(2 * HOUR);
      const { sent, provider } = recorder();
      await sendStaleRollCallAlerts(db, { now: NOW, origin: ORIGIN, provider });
      expect(toShore(sent)).toEqual([]);
      expect(await db.select().from(shopShoreAlertTokens)).toEqual([]);
    });

    it("cannot hold an address without its consent, or a confirmation without an address", async () => {
      const [staff] = await listStaff(ctx.db, ctx.shop.id);
      if (!staff) throw new Error("fixture staff missing");
      // Each refusal in a savepoint of its own, so the next one is asked.
      const refused = (set: Partial<typeof shops.$inferInsert>) =>
        ctx.db.transaction((tx) => tx.update(shops).set(set).where(eq(shops.id, ctx.shop.id)));
      await expect(refused({ shoreAlertEmail: SHORE })).rejects.toThrow();
      await expect(
        refused({ shoreAlertEmail: SHORE, shoreAlertConsentByPersonId: staff.person.id }),
      ).rejects.toThrow();
      await expect(
        refused({ shoreAlertConsentAt: NOW, shoreAlertConsentByPersonId: staff.person.id }),
      ).rejects.toThrow();
      await expect(refused({ shoreAlertConfirmedAt: NOW })).rejects.toThrow();
    });

    // Owner review #2 on H-20261014-stale-roll-call-recipients: Today's "Owners alerted" must stay true.
    it("never marks the owners alerted when only the shore contact was reached", async () => {
      await consentedShore();
      const { db, trip } = await departure(2 * HOUR);
      const { sent, provider } = recorder("failed", SHORE);
      expect(
        await sendStaleRollCallAlerts(db, { now: NOW, origin: ORIGIN, provider }),
      ).toMatchObject({ alerted: 1, released: 1, shoreEmails: 1 });
      expect(toShore(sent)).toHaveLength(1);
      expect(await claims(trip.id)).toEqual({ owners: null, shore: NOW });

      // The owners are asked again next pass; the shore contact is not.
      const retry = recorder();
      const later = new Date(NOW.getTime() + HOUR);
      await sendStaleRollCallAlerts(db, { now: later, origin: ORIGIN, provider: retry.provider });
      expect(toShore(retry.sent)).toEqual([]);
      expect(retry.sent.some((notification) => notification.kind === "roll_call_stale")).toBe(true);
      expect(await claims(trip.id)).toEqual({ owners: later, shore: NOW });
    });

    // EAP review #3 on H-20261014-stale-roll-call-recipients: a failed shore send is tried again next pass.
    it("tries the shore contact again next pass when only their send failed", async () => {
      await consentedShore();
      const { db, trip } = await departure(2 * HOUR);
      const failingShore: NotificationProvider = {
        async send(notification) {
          return notification.kind === "roll_call_stale_shore"
            ? { status: "failed", retryable: true, errorCode: "throttled" }
            : { status: "sent", providerMessageId: "msg" };
        },
      };
      expect(
        await sendStaleRollCallAlerts(db, { now: NOW, origin: ORIGIN, provider: failingShore }),
      ).toMatchObject({ alerted: 1, shoreEmails: 0 });
      expect(await claims(trip.id)).toEqual({ owners: NOW, shore: null });

      const retry = recorder();
      const later = new Date(NOW.getTime() + HOUR);
      expect(
        await sendStaleRollCallAlerts(db, { now: later, origin: ORIGIN, provider: retry.provider }),
      ).toMatchObject({ shoreEmails: 1 });
      expect(retry.sent.map((notification) => notification.kind)).toEqual([
        "roll_call_stale_shore",
      ]);
      expect(await claims(trip.id)).toEqual({ owners: NOW, shore: later });
    });

    it("gives both claims back when nobody was reached", async () => {
      await consentedShore();
      const { db, trip } = await departure(2 * HOUR);
      const { sent, provider } = recorder("failed");
      expect(
        await sendStaleRollCallAlerts(db, { now: NOW, origin: ORIGIN, provider }),
      ).toMatchObject({ alerted: 0, released: 1 });
      expect(toShore(sent)).toHaveLength(1);
      expect(await claims(trip.id)).toEqual({ owners: null, shore: null });
    });

    it("never tells the shore contact about a rehearsal, a canceled departure or a demo", async () => {
      await consentedShore();
      await departure(2 * HOUR, { rehearsal: true, title: "Practice" });
      const canceled = await departure(2 * HOUR, { title: "Blown out" });
      await ctx.db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, canceled.trip.id));
      const first = recorder();
      await sendStaleRollCallAlerts(ctx.db, { now: NOW, origin: ORIGIN, provider: first.provider });
      expect(toShore(first.sent)).toEqual([]);

      await departure(2 * HOUR, { title: "Demo boat" });
      await ctx.db.update(shops).set({ isDemo: true }).where(eq(shops.id, ctx.shop.id));
      const second = recorder();
      await sendStaleRollCallAlerts(ctx.db, {
        now: NOW,
        origin: ORIGIN,
        provider: second.provider,
      });
      expect(second.sent).toEqual([]);
    });

    async function ownerIsShore() {
      const owners = await ownerEmails();
      const [account] = await ctx.db
        .select({ personId: userAccounts.personId, email: userAccounts.email })
        .from(userAccounts)
        .where(and(inArray(userAccounts.personId, [...owners]), eq(userAccounts.status, "active")))
        .limit(1);
      const ownerAddress = account?.email;
      const ownerId = account?.personId;
      if (!ownerAddress || !ownerId) throw new Error("expected an owner with a login");
      await setShopShoreAlertContact(ctx.db, ctx.shop.id, {
        email: ownerAddress.toUpperCase(),
        consentAt: NOW,
        consentByPersonId: ownerId,
        confirmedAt: NOW,
      });
      return ownerAddress;
    }

    it("does not send a second copy to an owner who is also the shore contact", async () => {
      const ownerAddress = await ownerIsShore();
      const next = await departure(2 * HOUR, { title: "Second boat" });
      const { sent, provider } = recorder();
      await sendStaleRollCallAlerts(next.db, { now: NOW, origin: ORIGIN, provider });
      expect(toShore(sent)).toEqual([]);
      expect(sent.filter((n) => n.to.toLowerCase() === ownerAddress.toLowerCase())).toHaveLength(1);
      expect(await claims(next.trip.id)).toEqual({ owners: NOW, shore: NOW });
    });

    // Owner review #9 on H-20261014-stale-roll-call-recipients: the owners' copy failing must not swallow the shore copy.
    it("still sends the shore copy when that owner's own copy failed", async () => {
      const ownerAddress = await ownerIsShore();
      const next = await departure(2 * HOUR, { title: "Third boat" });
      const sent: Notification[] = [];
      const provider: NotificationProvider = {
        async send(notification) {
          sent.push(notification);
          return notification.kind === "roll_call_stale" &&
            notification.to.toLowerCase() === ownerAddress.toLowerCase()
            ? { status: "failed", retryable: false, errorCode: "test" }
            : { status: "sent", providerMessageId: `msg-${sent.length}` };
        },
      };
      await sendStaleRollCallAlerts(next.db, { now: NOW, origin: ORIGIN, provider });
      expect(toShore(sent)).toHaveLength(1);
      expect((await claims(next.trip.id))?.shore).toEqual(NOW);
    });
  });
});
