import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { gearItems, people } from "@/db/schema";
import { livePerson } from "@/db/trips-live";

export type RentalLookupFleet = {
  personId: string;
  tankTarget: string;
  suitTarget: string;
  sizeTarget: string;
};

/**
 * #2863's synthetic lookup workload, only through seed-trouble-states.
 * Replaces the demo's tank/suit view for this test, never its normal seed.
 * Labels put the exact-tag task at tank 95 and the first 2XL suit at 71.
 * No reservation, certification, fill or authorization rule is changed.
 */
export async function seedRentalLookupFleet(
  db: AppDb,
  shopId: string,
  now: Date,
): Promise<RentalLookupFleet> {
  const [renter] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.fullName, "Priya Sharma"), livePerson()))
    .limit(1);
  if (!renter) throw new Error("rental lookup fixture requires the seeded renter");

  const tanks = Array.from({ length: 100 }, (_, index) => ({
    shopId,
    kind: "tank" as const,
    label: `UX tank ${String(index + 1).padStart(3, "0")}`,
    size: "AL80",
  }));
  const suits = Array.from({ length: 80 }, (_, index) => ({
    shopId,
    kind: "wetsuit" as const,
    label: `UX suit ${String(index + 1).padStart(3, "0")}`,
    size: index < 60 ? ["S", "M", "L"][Math.floor(index / 20)] : index < 70 ? "XL" : "2XL",
    thicknessMm: 3,
  }));
  const labels = [...tanks, ...suits].map((unit) => unit.label);
  await db
    .insert(gearItems)
    .values([...tanks, ...suits])
    .onConflictDoNothing();
  // Only this explicitly requested workload replaces the seeded kinds. Reset
  // restores them before the next test; unrelated kinds remain available.
  await db
    .update(gearItems)
    .set({ deletedAt: now })
    .where(
      and(
        eq(gearItems.shopId, shopId),
        inArray(gearItems.kind, ["tank", "wetsuit"]),
        notInArray(gearItems.label, labels),
        isNull(gearItems.deletedAt),
      ),
    );
  return {
    personId: renter.id,
    tankTarget: "UX tank 095",
    suitTarget: "UX suit 071",
    sizeTarget: "2XL",
  };
}
