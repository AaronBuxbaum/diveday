/**
 * The night-before brief, framework-free. The evening-before reminder
 * (`trip_reminder_24h`) is the single cheapest cancellation-prevention tool a
 * shop has: most day-of no-shows are anxiety plus logistics confusion, not lost
 * interest. These helpers turn what the shop already knows — the crew's read on
 * conditions, the packing list, the dock-call time — into a warm, plain-language
 * brief. All pure: the DB layer (`src/db/reminders.ts`) gathers the inputs and
 * the notification renderers (`src/lib/notifications`) lay them out.
 */

/** The crew's published read on a trip's conditions; every field is optional. */
export type BriefConditions = {
  waterTemperatureC: number | null;
  visibilityMeters: number | null;
  /** Free-text surface read, e.g. "calm" or "0.5 m waves from NE". */
  surfaceConditions: string | null;
  /** The crew's own one-line summary, if they wrote one. */
  conditionsSummary: string | null;
};

/** End a crew sentence with a full stop so it reads cleanly before the stats clause. */
function ensureStop(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Oxford-comma join: [] → "", [a] → "a", [a,b] → "a and b", [a,b,c] → "a, b, and c". */
function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * One friendly, plain-language conditions line for the brief, or null when the
 * crew has published nothing. Built only from what the crew has said about this
 * trip — the cron path never fetches an external forecast per booking. The
 * crew's summary leads (it's the human read); the measured stats follow as a
 * short "expect …" clause so a nervous diver gets both the feel and the numbers.
 */
export function forecastLine(conditions: BriefConditions): string | null {
  const measured: string[] = [];
  if (conditions.waterTemperatureC !== null) {
    measured.push(`water around ${conditions.waterTemperatureC}°C`);
  }
  if (conditions.visibilityMeters !== null) {
    measured.push(`visibility near ${conditions.visibilityMeters} m`);
  }
  const surface = conditions.surfaceConditions?.trim();
  if (surface) measured.push(surface);

  const summary = conditions.conditionsSummary?.trim();
  const stats = measured.length ? `Expect ${joinClauses(measured)}.` : "";

  if (summary && stats) return `${ensureStop(summary)} ${stats}`;
  if (summary) return ensureStop(summary);
  return stats || null;
}

/**
 * The reassurance a first-timer needs and a seasoned diver doesn't. A diver
 * whose only certification is fresh is boarding a boat for the first time; the
 * same brief in a softer voice converts that anxiety into confidence. Returns
 * the extra "what happens on the boat" line, or null for an experienced diver.
 */
export function firstTimerReassurance(isFirstTimer: boolean): string | null {
  if (!isFirstTimer) return null;
  return "First boat dive? The crew walks everyone through the gear and the plan before you get in — you'll never be handed kit and left to figure it out. Come with questions.";
}
