import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { DAY_MS, nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { tripConservation, trips } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";

/**
 * What the crew picked up, cut or removed on past departures, so the shop's
 * conservation history reads as a season of work and not a single afternoon.
 * Each entry lands on its own returned departure, newest first.
 */
const HISTORY = [
  {
    kind: "litter_kg",
    quantity: 1.8,
    location: "Molasses Reef",
    note: "Discarded fishing gear and plastic collected by the crew.",
  },
  {
    kind: "lionfish_count",
    quantity: 7,
    location: "Benwood Wreck",
    note: "Crew recorded seven lionfish removed from the wreck.",
  },
  {
    kind: "line_m",
    quantity: 42,
    location: "French Reef",
    note: "Monofilament cut from the fire coral and sponges on the reef edge.",
  },
  {
    kind: "litter_items",
    quantity: 23,
    location: "Christ of the Abyss",
    note: "Cans, a tarp and rope from the mooring field.",
  },
  {
    kind: "lionfish_count",
    quantity: 4,
    location: "Spiegel Grove",
    note: "Four lionfish from the bow and the deck rails.",
  },
  {
    kind: "lionfish_count",
    quantity: 6,
    location: "French Reef",
    note: "Six lionfish removed along the reef edge.",
  },
  {
    kind: "lionfish_count",
    quantity: 3,
    location: "Molasses Reef",
    note: "Three lionfish recorded on the afternoon cleanup.",
  },
  {
    kind: "litter_kg",
    quantity: 3.2,
    location: "Pickles Reef",
    note: "Lobster-trap debris and plastic sheeting lifted onto the boat.",
  },
] as const;

/** Recorded cleanups on returned departures; no readiness or boarding rows change. */
export async function seedConservation(db: DbExecutor, shopId: string, recorderId: string) {
  const [existing] = await db
    .select({ id: tripConservation.id })
    .from(tripConservation)
    .where(and(eq(tripConservation.shopId, shopId), isNull(tripConservation.deletedAt)))
    .limit(1);
  if (existing) return;
  const past = await db
    .select({ id: trips.id, endsAt: trips.endsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        lt(trips.endsAt, new Date(nowDate().getTime() - DAY_MS)),
        notRehearsal(),
        liveTrip(),
      ),
    )
    // diveday:allow-time-id-order: seed picks the latest returned departures; no ordered list is shown.
    .orderBy(desc(trips.endsAt), desc(trips.id))
    .limit(HISTORY.length);
  if (past.length === 0) return;
  await db.insert(tripConservation).values(
    past.map((trip, i) => ({
      shopId,
      tripId: trip.id,
      ...HISTORY[i],
      recordedByPersonId: recorderId,
      recordedAt: trip.endsAt,
      updatedAt: trip.endsAt,
    })),
  );
}
