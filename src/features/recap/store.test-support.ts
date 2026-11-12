import { createBookingParty } from "@/db/bookings";
import { getTripManifest, recordRollCall } from "@/db/manifests";
import { upcomingTripsWithCounts } from "@/db/trips";
import type { seededShopContext } from "@/test/db";

const RAE = { fullName: "Rae Recap", email: "recap-rae@example.com" };

/**
 * Books a diver onto the demo reef day, in the file's shared database unless a
 * test hands it another. A test that needs a second booking on the same day
 * names a second diver: the same one twice is refused as `already_booked`.
 */
export async function recapFixtureContext(
  source: Awaited<ReturnType<typeof seededShopContext>>,
  diver: { fullName: string; email: string } = RAE,
) {
  const { db, shop } = source;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      ...diver,
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;
  // **The morning after**, so the cases below are about the four-hour pause
  // and nothing else. A recap is also held outside the shop's own civil hours
  // (`src/lib/send-window.ts`, issue #697) — the reef boat ties up at 6 PM, so
  // its recap comes due at 11 PM and is held until morning. That rule has its
  // own cases at the bottom of this file; mixing it into every delay assertion
  // would test two things at once. Fifteen hours after the boat ties up is
  // 9 AM local: past the mandatory four-hour pause and inside the window.
  const afterTrip = new Date(reef.endsAt.getTime() + 15 * 60 * 60 * 1000);
  return { db, shop, reef, bookingId, afterTrip };
}

/** Capture the sender's displayed state before the next tap, outside the writer. */
export async function recordObservedRecapMark(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  input: Parameters<typeof recordRollCall>[1],
) {
  const manifest = await getTripManifest(db, input.shopId, input.tripId, input.checkpoint);
  const context = manifest?.divers.find(
    (row) => row.bookingId === input.bookingId,
  )?.rollCallContext;
  return recordRollCall(db, {
    ...input,
    clientEventId: crypto.randomUUID(),
    observedEvidenceIds: context?.observedEvidenceIds ?? [],
    meetingDay: context?.meetingDay ?? 0,
  });
}
