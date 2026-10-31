import type { PersonalGearCode } from "@/lib/diver-planning";
import type { DiverMessageKey } from "./messages";

export const PERSONAL_GEAR_KEYS: Record<PersonalGearCode, DiverMessageKey> = {
  mask: "trip.personalGear.mask",
  fins: "trip.personalGear.fins",
  snorkel: "trip.personalGear.snorkel",
  boots: "trip.personalGear.boots",
};
