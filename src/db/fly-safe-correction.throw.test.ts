import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { recordFlySafeTold, sendFlySafeCorrections } from "./fly-safe-correction";
import { sendNotification } from "./notifications";
import { bookings, trips as tripRows } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **A throw mid-batch strands nobody** (issue #2927, domain review). Every
 * owed seat is claimed before the first send; whatever was not sent or queued
 * when something throws goes back to owed, so the next save tries again.
 */

/** A send door that throws on the n-th correction, as a database failure would. */
function throwingOn(n: number) {
  let calls = 0;
  return (async (...args: Parameters<typeof sendNotification>) => {
    calls += 1;
    if (calls === n) throw new Error("database went away");
    return sendNotification(...args);
  }) as typeof sendNotification;
}

const ctx = fileScopedShopContext();

async function threeToldSeats() {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = upcoming.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const ids: string[] = [];
  for (const name of ["Ana", "Ben", "Cy"]) {
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: `${name} Throw`,
        email: `flysafe-throw-${name.toLowerCase()}@example.com`,
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const bookingId = party.bookings[0].bookingId;
    await recordFlySafeTold(db, { shopId: shop.id, bookingId, hours: 24 });
    ids.push(bookingId);
  }
  await db.update(tripRows).set({ exceedsNoDecoLimits: true }).where(eq(tripRows.id, reef.id));
  return { db, shop, reef, ids };
}

async function correctedAt(db: typeof ctx.db, bookingId: string) {
  const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  return row?.flySafeCorrectedAt ?? null;
}

describe("sendFlySafeCorrections when something throws (#2927)", () => {
  it("puts back every seat not yet sent, keeps the one that went, and rethrows", async () => {
    const { db, shop, reef, ids } = await threeToldSeats();
    const mail = fakeEmail();
    await expect(
      sendFlySafeCorrections(db, {
        shopId: shop.id,
        tripId: reef.id,
        emailProvider: mail.provider,
        send: throwingOn(2),
      }),
    ).rejects.toThrow("database went away");
    const stamps = await Promise.all(ids.map((id) => correctedAt(db, id)));
    expect(stamps.filter((stamp) => stamp !== null)).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
    const sentSeat = mail.sent[0] && "seatId" in mail.sent[0] ? mail.sent[0].seatId : null;
    expect(await correctedAt(db, sentSeat ?? "")).not.toBeNull();

    // The next save corrects the two left owed, and only them.
    const retry = fakeEmail();
    const again = await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      emailProvider: retry.provider,
    });
    expect(again.told).toBe(2);
    expect(retry.sent.map((n) => ("seatId" in n ? n.seatId : null))).not.toContain(sentSeat);
  });

  it("does not strand the rest when the provider itself throws: that send is queued", async () => {
    const { db, shop, reef, ids } = await threeToldSeats();
    let providerCalls = 0;
    const mail = fakeEmail(undefined, {
      async send() {
        providerCalls += 1;
        if (providerCalls === 2) throw new Error("provider down");
        return { status: "sent", providerMessageId: "em_1" };
      },
    });
    const outcome = await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      emailProvider: mail.provider,
    });
    expect(outcome.told).toBe(2);
    expect(outcome.failed).toBe(1);
    // All three claimed: two went, one waits in the retry queue.
    for (const id of ids) expect(await correctedAt(db, id)).not.toBeNull();
  });
});
