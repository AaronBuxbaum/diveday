import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { sendDueReminders } from "./reminders";
import { bookingCapabilities } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

const state = vi.hoisted(() => ({ fail: false }));

vi.mock("./notifications", async (importActual) => {
  const actual = await importActual<typeof import("./notifications")>();
  return {
    ...actual,
    sendNotification: (...args: Parameters<typeof actual.sendNotification>) => {
      if (state.fail) throw new Error("the send fell over");
      return actual.sendNotification(...args);
    },
  };
});

const ctx = fileScopedShopContext();

/**
 * **A pass that throws part-way takes no link back** (issue #2711). The link
 * is the booking's one live delivered link, which an earlier email may carry;
 * revoking it because this pass died would strand the diver.
 */
describe("the trip-prep links of a reminder pass that throws part-way", () => {
  it("stay live, one per booking, including those of sends it never reached", async () => {
    const { db, shop } = ctx;
    const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = upcoming.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Pat Party",
        email: "throw-reminder@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const bookingId = party.bookings[0].bookingId;

    state.fail = true;
    try {
      await expect(
        sendDueReminders(db, {
          now: new Date(reef.startsAt.getTime() - 100 * 60 * 60 * 1000),
          emailProvider: fakeEmail().provider,
          smsProvider: fakeSms().provider,
          appOrigin: "https://diveday.example",
        }),
      ).rejects.toThrow("the send fell over");
    } finally {
      state.fail = false;
    }

    const minted = await db
      .select()
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, bookingId));
    expect(minted).toHaveLength(1);
    expect(minted.every((row) => row.revokedAt === null && row.delivered)).toBe(true);
  });
});
