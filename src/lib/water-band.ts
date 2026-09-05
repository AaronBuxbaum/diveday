import { utcToWallTime } from "./zoned";

/**
 * **The water band's clock** — ADR 20260904-reef-all-the-way-down, decision 2,
 * Budget rule 1.
 *
 * Reef's page top settles a lagoon wash into the sand over the first 168px of
 * every staff page (ADR 20260901-diveday-reimagined, decision 1). It was one
 * gradient at every hour, which is the whole of the third finding that ADR
 * 20260904 opens with: between Reef's three moments no surface said what time
 * it was. So the band takes one of four washes, and this is the only thing
 * that decides which.
 *
 * Two rules the shape enforces:
 *
 * - **The hour is the shop's, never the host's.** Every DiveDay server and CI
 *   box runs UTC, so a band chosen from the machine's clock would read dusk to
 *   a Key Largo shop at half past one in the afternoon. The zone is a required
 *   parameter for the same reason `src/lib/format.ts`'s formatters take one.
 * - **A wash is not a status** (Budget rule 8). Nothing here reads a booking,
 *   a blocker or a departure; the band carries no fact, which is why it may
 *   sit behind a manifest where the swell may not. The four are lagoon-family
 *   and sand, never coral — `src/lib/water-band-palette.test.ts` holds that
 *   against `globals.css` rather than trusting the names below.
 *
 * Dawn and dusk are the ADR's own bounds (5-8 and 17-20). Day is what is left
 * between them and night is what is left around them, so the four are total
 * and no hour falls through.
 */
export type WaterBand = "dawn" | "day" | "dusk" | "night";

export function waterBandFor(now: Date, timeZone: string): WaterBand {
  const { hour } = utcToWallTime(now, timeZone);
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}
