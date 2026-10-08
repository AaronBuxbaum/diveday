import type { ComponentProps } from "react";
import { getDb } from "@/db/client";
import { countGearItems } from "@/db/gear";
import { listOpenCounterRentalsForPerson } from "@/db/gear-counter-rentals";
import type { Shop } from "@/db/schema";
import { counterRentalFormPath } from "../../../gear/rentals/rental-form";
import { GearAndSizes } from "./GearAndSizes";

/**
 * **Gear and sizes, plus what this person has from the counter** (ADR
 * 20260815-minimal-gear-register, amended 2026-10-08).
 *
 * The record's gear group with its two counter-rental reads done here rather
 * than in the route, which is at its length budget: the open rentals this
 * person holds, and whether the shop has a fleet to lend from at all — the
 * "Rent gear" door is offered only then, and never for a removed person.
 * Shop-scoped from the session's shop like every read on the record.
 */
export async function GearAndSizesWithRentals({
  shop,
  ...props
}: Omit<ComponentProps<typeof GearAndSizes>, "rentalItems" | "counterRentals" | "rentGearHref"> & {
  shop: Pick<Shop, "id" | "rentalItems">;
}) {
  const db = await getDb();
  const removed = Boolean(props.diver.person.deletedAt);
  const [counterRentals, fleetSize] = await Promise.all([
    listOpenCounterRentalsForPerson(db, shop.id, props.personId),
    removed ? 0 : countGearItems(db, shop.id),
  ]);
  return (
    <GearAndSizes
      {...props}
      rentalItems={shop.rentalItems}
      counterRentals={counterRentals}
      rentGearHref={
        fleetSize > 0
          ? counterRentalFormPath(props.shopSlug, { personId: props.personId })
          : undefined
      }
    />
  );
}
