/** Ordinary departures and course sessions have different planned-dive limits. */
export const MAX_TRIP_DIVES = 4;
export const MAX_COURSE_DIVES = 5;

export function maxPlannedDives(courseSession: boolean): 4 | 5 {
  return courseSession ? MAX_COURSE_DIVES : MAX_TRIP_DIVES;
}
