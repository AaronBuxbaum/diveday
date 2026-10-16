// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeCheckout, fakeEmail } from "@/test/fakes";
import { cancelBooking, createBookingParty } from "./bookings";
import {
  markCheckoutExpiredBySessionId,
  markCheckoutPaidBySessionId,
  startBookingCheckout,
} from "./checkouts";
import { sendPartyPaymentReceipt } from "./party-payment-receipt";
import { people } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { upcomingTripsWithCounts, updateTrip } from "./trips";

/**
 * **The lead hears the group total once Stripe says it is paid** (#2566). The
 * confirmation goes out before the payment exists, so this is the one message
 * that names what Stripe settled. The webhook sends it only on the delivery
 * that completes the checkout (`firstCompletion`), so these tests drive the
 * same gate the route does.
 */
const ctx = fileScopedShopContext();

async function group(names: string[]) {
  const { db, shop } = ctx;
  await upsertShopStripeAccount(db, shop.id, "acct_test");
  await setShopStripeAccountStatus(db, "acct_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  await updateTrip(db, shop.id, reef.id, {
    title: reef.title,
    startsAt: reef.startsAt,
    endsAt: reef.endsAt,
    capacity: reef.capacity,
    plannedDives: reef.plannedDives,
    priceCents: 18_000,
  });
  const party = await createBookingParty(
    db,
    names.map((fullName, index) => ({
      actor: "staff" as const,
      shopId: shop.id,
      tripId: reef.id,
      fullName,
      email: `${fullName.split(" ")[0]?.toLowerCase()}${index}@example.com`,
    })),
  );
  if (!party.ok) throw new Error(`party booking failed: ${party.reason}`);
  const bookingIds = party.bookings.map((b) => b.bookingId);
  const started = await startBookingCheckout(
    db,
    {
      shopId: shop.id,
      tripId: reef.id,
      bookingIds,
      customerEmail: "lead@example.com",
      successUrl: "https://diveday.example/return",
      cancelUrl: "https://diveday.example/cancel",
      describeLine: ({ tripTitle }) => tripTitle,
    },
    fakeCheckout(),
  );
  if (!started.ok) throw new Error(`checkout refused: ${started.reason}`);
  return { db, shop, bookingIds, checkout: started.checkout };
}

/** What the webhook does on a paid event: settle, then the receipt on the first completion only. */
async function deliverPaid(
  g: Awaited<ReturnType<typeof group>>,
  email: ReturnType<typeof fakeEmail>,
  settledCents: number | null = 31_590,
) {
  const outcome = { firstCompletion: false };
  const checkout = await markCheckoutPaidBySessionId(
    g.db,
    g.checkout.stripeSessionId,
    undefined,
    settledCents,
    undefined,
    outcome,
  );
  if (checkout && outcome.firstCompletion) {
    return {
      first: true,
      result: await sendPartyPaymentReceipt(g.db, checkout, { provider: email.provider }),
    };
  }
  return { first: false, result: null };
}

describe("markCheckoutPaidBySessionId firstCompletion", () => {
  it("is true on the completing call only, never on a replay", async () => {
    const g = await group(["Pat Party", "Sam Second"]);
    const email = fakeEmail();
    expect((await deliverPaid(g, email)).first).toBe(true);
    expect((await deliverPaid(g, email)).first).toBe(false);
    expect((await deliverPaid(g, email)).first).toBe(false);
  });

  it("is false for a checkout already expired locally (paid after close)", async () => {
    const g = await group(["Pat Party", "Sam Second"]);
    await markCheckoutExpiredBySessionId(g.db, g.checkout.stripeSessionId);
    expect((await deliverPaid(g, fakeEmail())).first).toBe(false);
  });
});

describe("sendPartyPaymentReceipt", () => {
  it("tells the lead what Stripe settled for the whole group, and only once however often Stripe says so", async () => {
    const g = await group(["Pat Party", "Sam Second"]);
    const email = fakeEmail();
    expect((await deliverPaid(g, email)).result).toBe("sent");
    await deliverPaid(g, email);
    await deliverPaid(g, email);
    expect(email.sent).toHaveLength(1);
    const [sent] = email.sent;
    if (sent?.kind !== "party_payment_receipt") throw new Error("wrong kind");
    expect(sent).toMatchObject({
      to: "pat0@example.com",
      checkoutId: g.checkout.id,
      seats: 2,
      // Stripe's settled figure, not the 36,000 that was asked.
      amountCents: 31_590,
      currency: g.checkout.currency,
    });
  });

  it("sends nothing when Stripe reported no settled total", async () => {
    const g = await group(["Pat Party", "Sam Second"]);
    const email = fakeEmail();
    expect((await deliverPaid(g, email, null)).result).toBe("no_settled_total");
    expect(email.sent).toHaveLength(0);
  });

  it("sends nothing for a single seat, which already gets Stripe's own receipt", async () => {
    const g = await group(["Solo Diver"]);
    const email = fakeEmail();
    expect((await deliverPaid(g, email, 17_000)).result).toBe("not_a_group");
    expect(email.sent).toHaveLength(0);
  });

  it("sends nothing when the lead cancelled before the money landed", async () => {
    const g = await group(["Pat Party", "Sam Second"]);
    const lead = g.bookingIds[0];
    if (!lead) throw new Error("no lead");
    await cancelBooking(g.db, g.shop.id, lead);
    const email = fakeEmail();
    await deliverPaid(g, email);
    expect(email.sent).toHaveLength(0);
  });

  it("sends nothing to a lead with no address", async () => {
    const g = await group(["Pat Party", "Sam Second"]);
    await g.db.update(people).set({ email: null }).where(eq(people.fullName, "Pat Party"));
    const email = fakeEmail();
    expect((await deliverPaid(g, email)).result).toBe("no_address");
    expect(email.sent).toHaveLength(0);
  });

  it("never throws at the webhook when the provider does", async () => {
    const g = await group(["Pat Party", "Sam Second"]);
    const email = fakeEmail(undefined, {
      async send() {
        throw new Error("ses down");
      },
    });
    const { result } = await deliverPaid(g, email);
    expect(result).toBe("not_sent");
  });
});
