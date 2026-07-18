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
