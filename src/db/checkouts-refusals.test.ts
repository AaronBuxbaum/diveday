import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { recordingCheckout } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { startBookingCheckout } from "./checkouts";
import { trips } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { editTrip, upcomingTripsWithCounts } from "./trips";

/**
 * **What a checkout refuses before it asks Stripe for anything** (issue
 * #3832): no seats, a rehearsal departure, and a departure with no price. Each
 * answers with a refusal and opens no session.
 */
const ctx = fileScopedShopContext();

async function seats(priceCents = 12_000) {
  const { db, shop } = ctx;
  await upsertShopStripeAccount(db, shop.id, "acct_test");
  await setShopStripeAccountStatus(db, "acct_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const reef = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((t) =>
    t.title.startsWith("Two-Tank Reef — Molasses"),
  );
  if (!reef) throw new Error("demo reef trip missing");
  await editTrip(db, shop.id, reef.id, {
    title: reef.title,
    startsAt: reef.startsAt,
    endsAt: reef.endsAt,
    capacity: reef.capacity,
    plannedDives: reef.plannedDives,
    priceCents,
  });
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Rory Refused",
      email: `rory-${crypto.randomUUID()}@example.com`,
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  return { db, shop, reef, bookingIds: party.bookings.map((b) => b.bookingId) };
}

function input(shopId: string, tripId: string, bookingIds: string[]) {
  return {
    shopId,
    tripId,
    bookingIds,
    customerEmail: "rory@example.com",
    successUrl: "https://diveday.example/return",
    cancelUrl: "https://diveday.example/cancel",
    describeLine: ({ tripTitle }: { isDeposit: boolean; tripTitle: string }) => tripTitle,
  };
}

describe("startBookingCheckout refusals", () => {
  it("refuses a checkout with no seats in it", async () => {
    const { db, shop, reef } = await seats();
    const seen = recordingCheckout();
    expect(await startBookingCheckout(db, input(shop.id, reef.id, []), seen.provider)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(seen.requests).toEqual([]);
  });

  it("refuses a rehearsal departure, which no diver can buy", async () => {
    const { db, shop, reef, bookingIds } = await seats();
    await db
      .update(trips)
      .set({ isRehearsal: true, isPrivate: true, priceCents: null })
      .where(eq(trips.id, reef.id));
    const seen = recordingCheckout();
    expect(
      await startBookingCheckout(db, input(shop.id, reef.id, bookingIds), seen.provider),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(seen.requests).toEqual([]);
  });

  it("answers unpriced for a free departure with nothing to pass through", async () => {
    const { db, shop, reef, bookingIds } = await seats(0);
    const seen = recordingCheckout();
    expect(
      await startBookingCheckout(db, input(shop.id, reef.id, bookingIds), seen.provider),
    ).toEqual({ ok: false, reason: "unpriced" });
    expect(seen.requests).toEqual([]);
  });
});
