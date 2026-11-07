import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { sendDueReminders } from "./reminders";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **A shared inbox's other diver is reminded at the inbox that booked them**
 * (Aaron 2026-11-06). Their record holds no email, since the address belongs
 * to the diver already on file; the seat keeps it (`bookings.delivery_email`).
 */
const ctx = fileScopedShopContext();

describe("sendDueReminders on a shared inbox", () => {
  it("reminds the second diver at the address they typed", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const seat = (fullName: string) => ({
      actor: "public" as const,
      shopId: shop.id,
      tripId: reef.id,
      fullName,
      email: "hales@example.com",
    });
    const party = await createBookingParty(db, [seat("Ann Hale"), seat("Bo Hale")]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const [ann, bo] = party.bookings;
    if (!ann || !bo || ann.personId === bo.personId) throw new Error("expected two divers");

    const email = fakeEmail();
    await sendDueReminders(db, {
      now: new Date(reef.startsAt.getTime() - 100 * 60 * 60 * 1000),
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: null,
    });

    const toBo = email.sent.filter((n) => "bookingId" in n && n.bookingId === bo.bookingId);
    expect(toBo.map((n) => [n.kind, "to" in n ? n.to : null])).toEqual([
      ["trip_reminder_7d", "hales@example.com"],
    ]);
  });
});
