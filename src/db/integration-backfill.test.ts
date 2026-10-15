import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { recordingCheckout } from "@/test/fakes";
import { createBooking } from "./bookings";
import { markCheckoutPaidBySessionId, startBookingCheckout } from "./checkouts";
import { previewIntegrationBackfill, runIntegrationBackfill } from "./integration-backfill";
import {
  bookingCheckouts,
  integrationDeliveries,
  integrationEvents,
  shopIntegrations,
  shops,
  tips,
  trips,
} from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { upcomingTripsWithCounts, updateTrip } from "./trips";

const ctx = fileScopedShopContext();
const DAY = 86_400_000;
// One provider for the file: its session ids count up, and they are unique in the table.
const checkoutProvider = recordingCheckout().provider;

async function priced() {
  const { db, shop } = ctx;
  await upsertShopStripeAccount(db, shop.id, "acct_backfill");
  await setShopStripeAccountStatus(db, "acct_backfill", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const trip = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((t) =>
    t.title.startsWith("Two-Tank Reef — Molasses"),
  );
  if (!trip) throw new Error("demo reef trip missing");
  await updateTrip(db, shop.id, trip.id, {
    title: trip.title,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    capacity: trip.capacity,
    plannedDives: trip.plannedDives,
    priceCents: 18_000,
  });
  // The demo data carries checkouts and tips of its own; push them far behind
  // every window these tests ask about, so the counts are the test's own.
  const longAgo = new Date(nowDate().getTime() - 400 * DAY);
  await db.update(bookingCheckouts).set({ completedAt: longAgo });
  await db.update(tips).set({ completedAt: longAgo });
  return { db, shop, trip };
}

let seq = 0;
/** A checkout that completed `daysAgo` days ago, through the live path. */
async function completedCheckout(
  f: Awaited<ReturnType<typeof priced>>,
  daysAgo: number,
  refundedCents = 0,
) {
  seq += 1;
  const booked = await createBooking(f.db, {
    actor: "public",
    shopId: f.shop.id,
    tripId: f.trip.id,
    fullName: `Backfill Diver ${seq}`,
    email: `backfill-${seq}@example.com`,
  });
  if (!booked.ok) throw new Error(`booking failed: ${booked.reason}`);
  const started = await startBookingCheckout(
    f.db,
    {
      shopId: f.shop.id,
      tripId: f.trip.id,
      bookingIds: [booked.bookingId],
      customerEmail: `backfill-${seq}@example.com`,
      successUrl: "https://diveday.example/ok",
      cancelUrl: "https://diveday.example/no",
      describeLine: ({ tripTitle }) => tripTitle,
    },
    checkoutProvider,
  );
  if (!started.ok) throw new Error(`checkout failed: ${started.reason}`);
  await markCheckoutPaidBySessionId(f.db, started.checkout.stripeSessionId);
  await f.db
    .update(bookingCheckouts)
    .set({ completedAt: new Date(nowDate().getTime() - daysAgo * DAY), refundedCents })
    .where(eq(bookingCheckouts.id, started.checkout.id));
  return { checkoutId: started.checkout.id, bookingId: booked.bookingId };
}

async function paidTip(f: Awaited<ReturnType<typeof priced>>, bookingId: string, daysAgo: number) {
  seq += 1;
  const [row] = await f.db
    .insert(tips)
    .values({
      shopId: f.shop.id,
      bookingId,
      status: "paid",
      stripeAccountId: "acct_backfill",
      stripeSessionId: `cs_tip_backfill_${seq}`,
      currency: "usd",
      amountCents: 2_000,
      completedAt: new Date(nowDate().getTime() - daysAgo * DAY),
    })
    .returning();
  if (!row) throw new Error("tip insert failed");
  return row.id;
}

async function connect(
  shopId: string,
  provider: "zapier" | "quickbooks" | "xero",
  eventTypes: string[] = ["order.paid", "order.refunded"],
) {
  const [row] = await ctx.db
    .insert(shopIntegrations)
    .values({ shopId, provider, credentialsSealed: "sealed", settings: { eventTypes } })
    .returning();
  if (!row) throw new Error("integration insert failed");
  return row;
}

const since = (daysAgo: number) => new Date(nowDate().getTime() - daysAgo * DAY);

async function deliveriesOf(integrationId: string) {
  return ctx.db
    .select({ delivery: integrationDeliveries, key: integrationEvents.idempotencyKey })
    .from(integrationDeliveries)
    .innerJoin(integrationEvents, eq(integrationEvents.id, integrationDeliveries.eventId))
    .where(eq(integrationDeliveries.integrationId, integrationId))
    .orderBy(asc(integrationDeliveries.nextAttemptAt));
}

describe("integration backfill (issue #2606)", () => {
  it("previews the checkouts, tips and refunds since the start date, and writes nothing", async () => {
    const f = await priced();
    const old = await completedCheckout(f, 40);
    const recent = await completedCheckout(f, 10, 5_000);
    await paidTip(f, recent.bookingId, 9);
    await paidTip(f, old.bookingId, 41);
    const zap = await connect(f.shop.id, "zapier");

    const preview = await previewIntegrationBackfill(f.db, {
      shopId: f.shop.id,
      integrationId: zap.id,
      since: since(30),
    });

    expect(preview).toEqual({
      ok: true,
      provider: "zapier",
      counts: { checkouts: 1, tips: 1, refunds: 1 },
    });
    expect(await deliveriesOf(zap.id)).toHaveLength(0);
  });

  it("sends oldest first to the chosen integration only, and a second run sends nothing", async () => {
    const f = await priced();
    const newer = await completedCheckout(f, 5);
    const older = await completedCheckout(f, 20, 4_000);
    const tip = await paidTip(f, newer.bookingId, 3);
    const zap = await connect(f.shop.id, "zapier");
    const xero = await connect(f.shop.id, "xero");

    const run = await runIntegrationBackfill(f.db, {
      shopId: f.shop.id,
      integrationId: zap.id,
      since: since(30),
    });
    expect(run).toEqual({
      ok: true,
      sent: { checkouts: 2, tips: 1, refunds: 1 },
      remaining: 0,
    });

    const queued = await deliveriesOf(zap.id);
    expect(queued.map((row) => row.key)).toEqual([
      `checkout:${older.checkoutId}:paid`,
      `checkout:${older.checkoutId}:refund:4000`,
      `checkout:${newer.checkoutId}:paid`,
      `tip:${tip}:paid`,
    ]);
    expect(queued.every((row) => row.delivery.status === "pending")).toBe(true);
    expect(await deliveriesOf(xero.id)).toHaveLength(0);

    const again = await runIntegrationBackfill(f.db, {
      shopId: f.shop.id,
      integrationId: zap.id,
      since: since(30),
    });
    expect(again).toEqual({
      ok: true,
      sent: { checkouts: 0, tips: 0, refunds: 0 },
      remaining: 0,
    });
    expect(await deliveriesOf(zap.id)).toHaveLength(4);
  });

  it("sends nothing twice when the live path already delivered to this provider", async () => {
    const f = await priced();
    const zap = await connect(f.shop.id, "zapier");
    const live = await completedCheckout(f, 2);
    expect(await deliveriesOf(zap.id)).toHaveLength(1);

    const preview = await previewIntegrationBackfill(f.db, {
      shopId: f.shop.id,
      integrationId: zap.id,
      since: since(30),
    });
    expect(preview).toMatchObject({ ok: true, counts: { checkouts: 0, tips: 0, refunds: 0 } });
    await runIntegrationBackfill(f.db, {
      shopId: f.shop.id,
      integrationId: zap.id,
      since: since(30),
    });
    const events = await f.db
      .select()
      .from(integrationEvents)
      .where(
        and(
          eq(integrationEvents.shopId, f.shop.id),
          eq(integrationEvents.idempotencyKey, `checkout:${live.checkoutId}:paid`),
        ),
      );
    expect(events).toHaveLength(1);
    expect(await deliveriesOf(zap.id)).toHaveLength(1);
  });

  it("reuses an event the live path wrote before this provider was connected", async () => {
    const f = await priced();
    const early = await completedCheckout(f, 2);
    const zap = await connect(f.shop.id, "zapier");
    expect(await deliveriesOf(zap.id)).toHaveLength(0);

    await runIntegrationBackfill(f.db, {
      shopId: f.shop.id,
      integrationId: zap.id,
      since: since(30),
    });

    const events = await f.db
      .select()
      .from(integrationEvents)
      .where(eq(integrationEvents.idempotencyKey, `checkout:${early.checkoutId}:paid`));
    expect(events).toHaveLength(1);
    expect(await deliveriesOf(zap.id)).toHaveLength(1);
  });

  it("does not resend to a provider that was reconnected after it already had the event", async () => {
    const f = await priced();
    const zap = await connect(f.shop.id, "zapier");
    await completedCheckout(f, 2);
    await f.db
      .update(shopIntegrations)
      .set({ deletedAt: nowDate() })
      .where(eq(shopIntegrations.id, zap.id));
    const reconnected = await connect(f.shop.id, "zapier");

    const preview = await previewIntegrationBackfill(f.db, {
      shopId: f.shop.id,
      integrationId: reconnected.id,
      since: since(30),
    });
    expect(preview).toMatchObject({ ok: true, counts: { checkouts: 0 } });
  });

  it("respects the events the integration subscribed to", async () => {
    const f = await priced();
    await completedCheckout(f, 2, 3_000);
    const zap = await connect(f.shop.id, "zapier", ["order.paid"]);
    const preview = await previewIntegrationBackfill(f.db, {
      shopId: f.shop.id,
      integrationId: zap.id,
      since: since(30),
    });
    expect(preview).toMatchObject({ ok: true, counts: { checkouts: 1, refunds: 0 } });
  });

  it("sends nothing for a rehearsal departure", async () => {
    const f = await priced();
    await completedCheckout(f, 2);
    await f.db
      .update(trips)
      .set({ isRehearsal: true, isPrivate: true })
      .where(eq(trips.id, f.trip.id));
    const zap = await connect(f.shop.id, "zapier");
    const preview = await previewIntegrationBackfill(f.db, {
      shopId: f.shop.id,
      integrationId: zap.id,
      since: since(30),
    });
    expect(preview).toMatchObject({ ok: true, counts: { checkouts: 0, tips: 0, refunds: 0 } });
  });

  it("never reads or fans out for another shop's integration", async () => {
    const f = await priced();
    await completedCheckout(f, 2);
    const [other] = await f.db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-backfill", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    const theirs = await connect(other.id, "zapier");

    // Our shop id with their integration, and their shop id with ours.
    const mine = await connect(f.shop.id, "quickbooks");
    expect(
      await previewIntegrationBackfill(f.db, {
        shopId: f.shop.id,
        integrationId: theirs.id,
        since: since(30),
      }),
    ).toEqual({ ok: false, reason: "integration_unavailable" });
    expect(
      await runIntegrationBackfill(f.db, {
        shopId: other.id,
        integrationId: mine.id,
        since: since(30),
      }),
    ).toEqual({ ok: false, reason: "integration_unavailable" });

    // Their own integration, their own shop: our checkouts are not theirs to see.
    expect(
      await runIntegrationBackfill(f.db, {
        shopId: other.id,
        integrationId: theirs.id,
        since: since(30),
      }),
    ).toEqual({ ok: true, sent: { checkouts: 0, tips: 0, refunds: 0 }, remaining: 0 });
    expect(await deliveriesOf(theirs.id)).toHaveLength(0);
    expect(await deliveriesOf(mine.id)).toHaveLength(0);
  });

  it("refuses a disconnected or errored integration", async () => {
    const f = await priced();
    const gone = await connect(f.shop.id, "zapier");
    await f.db
      .update(shopIntegrations)
      .set({ deletedAt: nowDate() })
      .where(eq(shopIntegrations.id, gone.id));
    const errored = await connect(f.shop.id, "xero");
    await f.db
      .update(shopIntegrations)
      .set({ status: "error" })
      .where(eq(shopIntegrations.id, errored.id));
    for (const id of [gone.id, errored.id]) {
      expect(
        await runIntegrationBackfill(f.db, {
          shopId: f.shop.id,
          integrationId: id,
          since: since(30),
        }),
      ).toEqual({ ok: false, reason: "integration_unavailable" });
    }
  });

  it("caps one run, oldest first, and the next run sends the rest", async () => {
    const f = await priced();
    const third = await completedCheckout(f, 3);
    const first = await completedCheckout(f, 9);
    const second = await completedCheckout(f, 6);
    const zap = await connect(f.shop.id, "zapier");
    const input = { shopId: f.shop.id, integrationId: zap.id, since: since(30), limit: 2 };

    expect(await runIntegrationBackfill(f.db, input)).toMatchObject({
      sent: { checkouts: 2 },
      remaining: 1,
    });
    expect((await deliveriesOf(zap.id)).map((row) => row.key)).toEqual([
      `checkout:${first.checkoutId}:paid`,
      `checkout:${second.checkoutId}:paid`,
    ]);
    expect(await runIntegrationBackfill(f.db, input)).toMatchObject({
      sent: { checkouts: 1 },
      remaining: 0,
    });
    expect((await deliveriesOf(zap.id)).map((row) => row.key)).toContain(
      `checkout:${third.checkoutId}:paid`,
    );
  });
});
