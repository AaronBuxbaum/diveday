import type { DbExecutor } from "@/db/client";
import { bookings, tripAssignments } from "@/db/schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "../../../db/trips";
import { getCurrentWaiverTemplate } from "../../../db/waivers";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "../../../lib/medical";
import { fileScopedShopContext } from "../../db";

// One seeded database for each importing test file and a rolled-back
// transaction per test.
export const ctx = fileScopedShopContext();

export const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);

export async function manifestContext() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [booking] = await getTripRoster(db, shop.id, reef.id);
  if (!booking) throw new Error("demo booking missing");
  const template = await getCurrentWaiverTemplate(db, shop.id);
  if (!template) throw new Error("demo waiver template missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  return { db, shop, reef, booking, template, staff: staff.person };
}

/** The assigned crew member's paid seat, for dual-role roll-call scenarios. */
export async function manifestCrewSeat(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  staffId: string,
) {
  await db.insert(tripAssignments).values({ tripId, personId: staffId }).onConflictDoNothing();
  const [seat] = await db
    .insert(bookings)
    .values({
      bookedAs: "diver",
      shopId,
      tripId,
      personId: staffId,
      status: "booked",
    })
    .returning({ id: bookings.id });
  if (!seat) throw new Error("expected the crew member's own seat");
  return seat;
}
