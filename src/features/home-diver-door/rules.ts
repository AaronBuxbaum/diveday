/**
 * HOME_DIVER_DOOR: whether the home hero carries the one line for a diver
 * ("Booked a dive? Find your booking").
 *
 * The line leads to `/find-your-booking`, which lists the shops a diver could
 * have booked with. Until a shop is listed that page is empty, and a shop
 * owner who follows the hero's only other link reads "No shops are listed
 * yet" one click from the headline (#4313; Aaron, 2026-11-11: "hide the button
 * behind a flag or something, which we can turn on once it's relevant"). The
 * page itself stays reachable at its address; only the hero's line waits.
 *
 * Off unless the variable is exactly `1`, so a typo leaves the line hidden
 * rather than showing an empty list to buyers.
 */

type Environment = Readonly<Record<string, string | undefined>>;

export function homeDiverDoorEnabled(env: Environment = process.env): boolean {
  return env.HOME_DIVER_DOOR?.trim() === "1";
}
