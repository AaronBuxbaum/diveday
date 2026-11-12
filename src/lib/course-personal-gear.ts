/** Course-fee kit that is not sold or reserved through the rental catalog. */
export const COURSE_PERSONAL_GEAR = ["snorkel", "boots"] as const;
export type CoursePersonalGear = (typeof COURSE_PERSONAL_GEAR)[number];

/** Keep only explicit, known inclusions, once each and in packing-list order. */
export function toCoursePersonalGear(values: readonly unknown[]): CoursePersonalGear[] {
  return COURSE_PERSONAL_GEAR.filter((kind) => values.includes(kind));
}
