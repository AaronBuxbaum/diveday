import type { CoursePersonalGear } from "@/lib/course-personal-gear";
import type { PersonalGearCode } from "@/lib/diver-planning";
import { cachedListFormat } from "@/lib/intl-cache";
import { type RentableItemKind, SCUBA_UNIT_KINDS, SCUBA_UNIT_PRESET } from "@/lib/rentals";
import type { DiverMessageKey } from "./messages";
import type { StaffMessageKey } from "./staff-messages";

export const COURSE_PERSONAL_GEAR_STAFF_KEYS: Record<CoursePersonalGear, StaffMessageKey> = {
  snorkel: "courses.edit.personalGearSnorkel",
  boots: "courses.edit.personalGearBoots",
};

export const PERSONAL_GEAR_KEYS: Record<PersonalGearCode, DiverMessageKey> = {
  mask: "trip.personalGear.mask",
  fins: "trip.personalGear.fins",
  snorkel: "trip.personalGear.snorkel",
  boots: "trip.personalGear.boots",
};

/** A rental kind's word on the packing list and wherever a course's included gear is named. */
export const RENTAL_ITEM_KEYS: Record<RentableItemKind, DiverMessageKey> = {
  bcd: "trip.rentalItems.bcd",
  regulator: "trip.rentalItems.regulator",
  wetsuit: "trip.rentalItems.wetsuit",
  mask: "trip.rentalItems.mask",
  fins: "trip.rentalItems.fins",
  weights: "trip.rentalItems.weights",
  dive_computer: "trip.rentalItems.diveComputer",
  gopro: "trip.rentalItems.gopro",
  drysuit: "trip.rentalItems.drysuit",
  hood: "trip.rentalItems.hood",
  gloves: "trip.rentalItems.gloves",
  torch: "trip.rentalItems.torch",
  smb: "trip.rentalItems.smb",
};

/**
 * Whether a course includes exactly the scuba unit, the preset a shop gets by
 * ticking "gear included" (issue #2796): the case the yes/no's own sentences
 * already say, word for word.
 */
export function includesScubaUnitOnly(
  included: readonly RentableItemKind[],
  personal: readonly CoursePersonalGear[] = [],
): boolean {
  return (
    personal.length === 0 &&
    included.length === SCUBA_UNIT_PRESET.length &&
    included.every((kind) => SCUBA_UNIT_KINDS.has(kind))
  );
}

/**
 * **What a course fee includes, as one list a diver reads** (issue #2796):
 * "Scuba unit (BCD, regulator, tank, weights) and Wetsuit". The whole unit is
 * said as the unit, the way the packing list's "Provided" says it, and every
 * other included kind by its own word.
 */
export function includedGearList(
  included: readonly RentableItemKind[],
  t: (key: DiverMessageKey) => string,
  locale: string,
  personal: readonly CoursePersonalGear[] = [],
): string {
  const wholeUnit = [...SCUBA_UNIT_KINDS].every((kind) => included.includes(kind));
  const words = [
    ...(wholeUnit ? [t("trip.providedItems.scubaUnit")] : []),
    ...included
      .filter((kind) => !(wholeUnit && SCUBA_UNIT_KINDS.has(kind)))
      .map((kind) => t(RENTAL_ITEM_KEYS[kind])),
    ...personal.map((kind) => t(PERSONAL_GEAR_KEYS[kind])),
  ];
  return cachedListFormat(locale, { type: "conjunction" }).format(words);
}
