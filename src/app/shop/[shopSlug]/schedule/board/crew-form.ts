import { z } from "zod";
import { type WeekdaySet, weekdaySetFrom } from "@/lib/recurrence";

/**
 * The crew chips the pattern offered, minus any the desk took off. Repeats of
 * one name, so read off the form directly like the weekday checkboxes.
 */
export function crewPersonIdsFrom(formData: FormData): string[] | null {
  const parsed = z.array(z.uuid()).safeParse(formData.getAll("crewPersonIds"));
  return parsed.success ? parsed.data : null;
}

/**
 * The weekday checkboxes, which a `FormData` carries as repeats of one name and
 * `Object.fromEntries` therefore collapses to the last one — so they are read
 * off the form directly rather than through the schema above.
 */
export function repeatWeekdaysFrom(formData: FormData): WeekdaySet {
  return weekdaySetFrom(formData.getAll("repeatWeekday").map((value) => Number(value)));
}
