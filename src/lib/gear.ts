import type { GearItem } from "@/db/schema";

export type GearAssignmentFailure = "not_available" | "service_hold" | "retired";

/** The assignment gate is intentionally tiny and auditable. */
export function gearAssignmentFailure(item: Pick<GearItem, "state">): GearAssignmentFailure | null {
  if (item.state === "available") return null;
  if (item.state === "service_hold") return "service_hold";
  if (item.state === "retired") return "retired";
  return "not_available";
}

export function gearAssignmentMessage(failure: GearAssignmentFailure): string {
  if (failure === "service_hold") return "This item is on service hold and cannot be assigned.";
  if (failure === "retired") return "This item has been retired and cannot be assigned.";
  return "This item is already assigned; choose another available item.";
}

export type PackableGearType = "bcd" | "regulator" | "wetsuit" | "mask_fins" | "weights" | "tank";

type PackingRequest = {
  bcd: boolean;
  regulator: boolean;
  wetsuit: boolean;
  maskFins: boolean;
  weights: boolean;
  tank: boolean;
  bcdSize?: string | null;
  wetsuitSize?: string | null;
  finSize?: string | null;
};

type PackingCandidate = { id: string; type: PackableGearType; size: string | null };

type PackingDiver = {
  bookingId: string;
  request: PackingRequest | null;
  assignedTypes: PackableGearType[];
};

export type GearRecommendation = { bookingId: string; gearItemId: string };

const requestTypes: { type: PackableGearType; requested: keyof PackingRequest }[] = [
  { type: "bcd", requested: "bcd" },
  { type: "regulator", requested: "regulator" },
  { type: "wetsuit", requested: "wetsuit" },
  { type: "mask_fins", requested: "maskFins" },
  { type: "weights", requested: "weights" },
  { type: "tank", requested: "tank" },
];

function preferredSize(request: PackingRequest, type: PackableGearType) {
  if (type === "bcd") return request.bcdSize;
  if (type === "wetsuit") return request.wetsuitSize;
  if (type === "mask_fins") return request.finSize;
  return null;
}

/**
 * Selects a non-reserving packing plan from one inventory snapshot. Sized
 * equipment only matches an exact requested size; staff can still choose a
 * different item explicitly after a dock-side fit check.
 */
export function recommendGearForRoster(
  divers: PackingDiver[],
  available: PackingCandidate[],
): GearRecommendation[] {
  const pool = [...available];
  const recommendations: GearRecommendation[] = [];
  for (const diver of divers) {
    if (!diver.request) continue;
    for (const { type, requested } of requestTypes) {
      if (!diver.request[requested] || diver.assignedTypes.includes(type)) continue;
      const size = preferredSize(diver.request, type)?.trim().toLowerCase();
      const index = pool.findIndex(
        (item) => item.type === type && (!size || item.size?.trim().toLowerCase() === size),
      );
      if (index < 0) continue;
      const [item] = pool.splice(index, 1);
      if (item) recommendations.push({ bookingId: diver.bookingId, gearItemId: item.id });
    }
  }
  return recommendations;
}
