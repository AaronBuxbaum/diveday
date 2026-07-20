import type {
  listCurrentGearAssignments,
  listGearInventory,
  listGearServiceEvents,
} from "@/db/gear";
import type { getShopById } from "@/db/shops";

export type Shop = NonNullable<Awaited<ReturnType<typeof getShopById>>>;
export type GearItem = Awaited<ReturnType<typeof listGearInventory>>[number];
export type GearAssignment = Awaited<ReturnType<typeof listCurrentGearAssignments>>[number];
export type GearServiceEvent = Awaited<ReturnType<typeof listGearServiceEvents>>[number];

export const GEAR_TYPES = {
  bcd: "BCD",
  regulator: "Regulator",
  wetsuit: "Wetsuit",
  mask_fins: "Mask & fins",
  weights: "Weights",
  tank: "Tank",
} as const;
