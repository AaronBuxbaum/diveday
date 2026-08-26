import { eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import {
  bookingPayments,
  bookings,
  type people,
  recapPhotos,
  trips,
  waiverRecords,
} from "./schema";
import { at, nextCreatedAt } from "./seed-clock";
import { commonsImage } from "./seed-images";
import { getCurrentWaiverTemplate } from "./waivers";

/**
 * A fixed booking id on the seeded reef trip, so a signed recap link can be
 * minted deterministically for the demo (visual tests, screenshots) without
 * querying a random-uuid booking out of the running server. Real bookings keep
 * their `defaultRandom` ids; only this one demo row is pinned.
 */
export const DEMO_RECAP_BOOKING_ID = "0de3c0de-1eaf-4b0a-9c0f-000000000001";

/**
 * Who is booked on what, and everything that follows from a seat being taken:
 * the payment or deposit against it, the waiver request it triggers, the recap
 * material for the trip that already sailed, and the shop's discount codes.
 *
 * The spread is the point — a busy reef trip, a quiet night dive, a sold-out
 * wreck, and a fresh listing with nobody on it yet — and so are the holdouts:
 * one diver whose waiver request quietly never went out, and one seat booked
 * through a shared inbox under a different name, which the roster shows as a
 * fail-closed "Confirm identity" gate.
 */
export async function seedBookings(
  db: DbExecutor,
  shopId: string,
  ctx: {
    customers: (typeof people.$inferSelect)[];
    tripRows: (typeof trips.$inferSelect)[];
    pinRecapBooking: boolean;
  },
) {
  const { customers, tripRows, pinRecapBooking } = ctx;
  // Booking spread: busy reef trip, quiet night dive, sold-out wreck, fresh listing.
  const [reef, night, wreck] = tripRows;
  if (!reef || !night || !wreck) throw new Error("seed: failed to insert demo trips");

  /**
   * Later sailings carry their own regulars — divers 10 and up, never the ten
   * who crew today's boat. Today's roster and its readiness counts are asserted
   * exactly; a name added to it changes what the departure board says.
   *
   * The remaining-seat counts these produce are load-bearing too. "N spots
   * left" is how e2e picks a trip out of the schedule, so no seeded trip may
   * leave six seats (a spec creates its own six-seat boat), only the reef trip
   * may leave three, and only the wreck charter may read Full.
   */
  const laterRosters: Array<[string, number[]]> = [
    ["Two-Tank Reef — Benwood & Elbow", [10, 11, 12]],
    ["Afternoon Two-Tank — French Reef", [13, 14, 15]],
    ["Nitrox Diver — classroom & two dives", [16, 17]],
    ["Night Diver — two evenings", [13]],
    ["Deep Diver — Spiegel Grove & the wall", [17]],
  ];
  const bookingRows = [
    // The first reef booking is pinned (canonical demo only) so a recap link can
    // be minted deterministically for the visual tests.
    ...customers.slice(0, 9).map((c, index) => ({
      tripId: reef.id,
      personId: c.id,
      ...(index === 0 && pinRecapBooking ? { id: DEMO_RECAP_BOOKING_ID } : {}),
    })),
    ...customers.slice(4, 7).map((c) => ({ tripId: night.id, personId: c.id })),
    ...customers.slice(0, 10).map((c) => ({ tripId: wreck.id, personId: c.id })),
    ...laterRosters.flatMap(([title, indexes]) => {
      const trip = tripRows.find((row) => row.title === title);
      if (!trip) return [];
      return indexes
        .map((index) => customers[index])
        .filter((person) => person !== undefined)
        .map((person) => ({ tripId: trip.id, personId: person.id }));
    }),
  ];
  const bookingRows_ = await db
    .insert(bookings)
    .values(
      bookingRows.map((row) => ({
        shopId,
        status: "booked" as const,
        createdAt: nextCreatedAt(),
        ...row,
      })),
    )
    .returning();

  // H-13 demo: one night-trip seat came in through a shared inbox under a
  // different name than the person already on file for that email, so it carries
  // the identity-unconfirmed flag. The roster shows the fail-closed "Confirm
  // identity" gate until staff vouch for it — the diver can't board on the
  // matched person's evidence. Reuses the booking's own createdAt so nothing new
  // is stamped against the clock. The diver is already blocked (no Night
  // specialty), so this adds a blocker rather than flipping a ready seat.
  const nightIdentityBooking = bookingRows_.find(
    (b) => b.tripId === night.id && b.personId === customers[4]?.id,
  );
  if (nightIdentityBooking) {
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nightIdentityBooking.createdAt })
      .where(eq(bookings.id, nightIdentityBooking.id));
  }

  // Payment demo, spread across the boats a visitor actually looks at — not
  // just the pay-to-board wreck charter. Reef and Night don't require payment
  // to board (requiresPayment is wreck-only), so these rows never change who
  // can board; they exist so Reports shows real revenue for the current month
  // instead of $0, including on a freshly minted "try the demo" shop, which
  // never runs seedHistory's back-fill.
  const wreckBookings = bookingRows_.filter((b) => b.tripId === wreck.id);
  const reefBookings = bookingRows_.filter((b) => b.tripId === reef.id);
  const nightBookings = bookingRows_.filter((b) => b.tripId === night.id);
  const findBooking = (rows: typeof bookingRows_, personIndex: number) =>
    rows.find((b) => b.personId === customers[personIndex]?.id);
  const bookingByTripTitle = (tripTitle: string, personIndex: number) => {
    const trip = tripRows.find((row) => row.title === tripTitle);
    if (!trip) return undefined;
    return findBooking(
      bookingRows_.filter((b) => b.tripId === trip.id),
      personIndex,
    );
  };
  const paidBooking = findBooking(wreckBookings, 1);
  const depositBooking = findBooking(wreckBookings, 0);

  const paymentPlan: Array<{
    booking: (typeof bookingRows_)[number] | undefined;
    status: "paid" | "deposit_paid";
    amountCents: number;
  }> = [
    // Wreck: a solid majority paid or on deposit, a few still owing 5 days out.
    { booking: paidBooking, status: "paid", amountCents: 18_000 },
    { booking: depositBooking, status: "deposit_paid", amountCents: 6_000 },
    { booking: findBooking(wreckBookings, 2), status: "paid", amountCents: 18_000 },
    { booking: findBooking(wreckBookings, 5), status: "paid", amountCents: 18_000 },
    { booking: findBooking(wreckBookings, 6), status: "deposit_paid", amountCents: 6_000 },
    // Reef: today's busy boat, paid ahead of the dock like a real morning.
    { booking: findBooking(reefBookings, 1), status: "paid", amountCents: 12_000 },
    { booking: findBooking(reefBookings, 2), status: "paid", amountCents: 12_000 },
    { booking: findBooking(reefBookings, 3), status: "paid", amountCents: 12_000 },
    { booking: findBooking(reefBookings, 5), status: "deposit_paid", amountCents: 4_000 },
    { booking: findBooking(reefBookings, 6), status: "paid", amountCents: 12_000 },
    { booking: findBooking(reefBookings, 7), status: "paid", amountCents: 12_000 },
    // Night: quiet boat, still a couple of paid seats.
    { booking: findBooking(nightBookings, 5), status: "paid", amountCents: 9_500 },
    { booking: findBooking(nightBookings, 6), status: "deposit_paid", amountCents: 3_500 },
    // Later sailings this month.
    {
      booking: bookingByTripTitle("Two-Tank Reef — Benwood & Elbow", 10),
      status: "paid",
      amountCents: 12_000,
    },
    {
      booking: bookingByTripTitle("Two-Tank Reef — Benwood & Elbow", 11),
      status: "deposit_paid",
      amountCents: 4_000,
    },
    {
      booking: bookingByTripTitle("Afternoon Two-Tank — French Reef", 13),
      status: "paid",
      amountCents: 11_000,
    },
    {
      booking: bookingByTripTitle("Afternoon Two-Tank — French Reef", 15),
      status: "deposit_paid",
      amountCents: 3_500,
    },
    {
      booking: bookingByTripTitle("Nitrox Diver — classroom & two dives", 16),
      status: "paid",
      amountCents: 19_500,
    },
    {
      booking: bookingByTripTitle("Night Diver — two evenings", 13),
      status: "paid",
      amountCents: 9_500,
    },
    {
      booking: bookingByTripTitle("Deep Diver — Spiegel Grove & the wall", 17),
      status: "deposit_paid",
      amountCents: 5_000,
    },
  ];
  const paymentSeed = paymentPlan
    .filter((row) => row.booking !== undefined)
    .map((row) => ({
      bookingId: (row.booking as (typeof bookingRows_)[number]).id,
      status: row.status,
      amountCents: row.amountCents,
    }));
  if (paymentSeed.length > 0) {
    await db
      .insert(bookingPayments)
      .values(paymentSeed.map((row) => ({ shopId, currency: "usd", ...row })));
  }

  // Post-trip recap demo: a crew shout-out on the pinned reef trip and a couple
  // of diver photos on the pinned recap booking, so /recap/[token] shows the
  // shout-out block and the photo strip out of the box.
  await db
    .update(trips)
    .set({
      recapShoutout:
        "What a day on the water — glassy surface and a curious green turtle on the second tank. Thanks for diving with us, and tag Blue Mantis in your shots!",
    })
    .where(eq(trips.id, reef.id));
  // The first reef booking carries the recap photos. On the canonical demo this
  // is the pinned id; on a minted demo it's whatever random id that booking got.
  const recapBookingId = bookingRows_.find(
    (b) => b.tripId === reef.id && b.personId === customers[0]?.id,
  )?.id;
  if (!recapBookingId) throw new Error("seed: recap booking missing from reef roster");
  await db.insert(recapPhotos).values([
    {
      shopId,
      bookingId: recapBookingId,
      tripId: reef.id,
      imageUrl: commonsImage("French Angelfish Molasses Reef 20080309.jpg"),
      caption: "French angelfish cruising the coral",
    },
    {
      shopId,
      bookingId: recapBookingId,
      tripId: reef.id,
      imageUrl: commonsImage("Blue Tangs Molasses Reef 1999.jpg"),
      caption: "A whole squad of blue tangs",
    },
  ]);

  // A real booking never sits with zero waiver activity: the live
  // booking-creation flow issues a waiver request the instant a diver joins a
  // trip (issueWaiverOnJoin). The seed mirrors that so every upcoming booking
  // already has a waiver on file — except the reef trip's first-booked diver
  // (the pinned recap booking above), who stays genuinely unsent. That one
  // holdout is the shop's real-world straggler — a request that quietly never
  // went out — and it's what keeps the "click Send waiver" flows (staff UI,
  // e2e) demonstrable.
  //
  // Most divers fill out their waiver before the boat leaves — that's the
  // norm at a real front desk, not the exception — so the seed signs it for
  // the large majority of upcoming bookings. A signature is effective for the
  // *person*, not just the one booking (effectiveWaiverForBooking in
  // src/lib/waivers.ts reuses a diver's latest completed waiver across every
  // trip they're on), so today's reef roster (customers 1-8; customer[0]
  // Priya is the deliberate holdout above) gets signed too. That still leaves
  // today's boat with one diver flagged "Readiness needs attention" — a
  // realistic morning, not an empty one (see e2e/manifest.spec.ts and
  // e2e/check-in.spec.ts, both keyed on Priya specifically). Wreck and Night
  // stay genuinely mixed regardless: wreck also gates on AOW + Deep +
  // verified nitrox + payment, and night on the Night specialty, so signing a
  // waiver alone clears at most one wreck seat (customer[1], already fully
  // carded and paid) and never touches night's specialty gate.
  const waiverTemplate = await getCurrentWaiverTemplate(db, shopId);
  if (!waiverTemplate) throw new Error("seed: waiver template missing before upcoming waivers");
  const signedWaiverBookingIds = new Set(
    [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((index) => findBooking(reefBookings, index)?.id),
      findBooking(wreckBookings, 9)?.id,
      bookingByTripTitle("Two-Tank Reef — Benwood & Elbow", 10)?.id,
      bookingByTripTitle("Afternoon Two-Tank — French Reef", 13)?.id,
      bookingByTripTitle("Nitrox Diver — classroom & two dives", 16)?.id,
    ].filter((id): id is string => id !== undefined),
  );
  let upcomingWaiverToken = 0;
  const upcomingWaiverRows = bookingRows_
    .filter((booking) => booking.id !== recapBookingId)
    .map((booking) => {
      upcomingWaiverToken++;
      const createdAt = nextCreatedAt();
      const signed = signedWaiverBookingIds.has(booking.id);
      return {
        shopId,
        bookingId: booking.id,
        personId: booking.personId,
        templateId: waiverTemplate.id,
        templateTitle: waiverTemplate.title,
        templateVersion: waiverTemplate.version,
        templateGeneration: waiverTemplate.materialGeneration,
        templateBody: waiverTemplate.body,
        // Never a real bearer token (nobody is meant to sign these seeded
        // links), but unique per shop row so a fleet of minted demo shops
        // can never collide on the table's global tokenHash constraint.
        tokenHash: `seed-waiver-${shopId}-${upcomingWaiverToken}`,
        // Comfortably past every seeded upcoming trip (furthest is ~21 days
        // out) so a fresh demo never opens with an already-expired link.
        expiresAt: at(30, 12),
        createdAt,
        ...(signed
          ? {
              status: "completed" as const,
              signedName: "Signed on file",
              signatureMethod: "in_person" as const,
              consentedAt: createdAt,
              signedAt: createdAt,
              completedAt: createdAt,
            }
          : {}),
      };
    });
  if (upcomingWaiverRows.length > 0) await db.insert(waiverRecords).values(upcomingWaiverRows);

  return {
    bookingRows: bookingRows_,
    wreck,
    waiverTemplate,
    // A fully paid booking, available to the promo scenario so its seeded
    // redemption agrees with the booking's payment state.
    promoRedemptionBooking: paidBooking ?? bookingRows_[0],
  };
}
