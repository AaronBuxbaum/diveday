import type { DemoStoryId } from "@/lib/demo-stories";
import { publicSchedulePath } from "@/lib/public-routes";
import type { AppDb } from "./client";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **Where each of the demo's three stories opens** (issue #1215).
 *
 * A destination in a shop that was minted seconds ago, never a mutation of a
 * shared one: `enterDemoAction` builds a whole seeded shop per entry, so the
 * ruling's "each resetting its state on entry" is satisfied by the mint itself
 * and there is nothing here to reset.
 *
 * Every path is a **real product surface** the visitor could have navigated to
 * themselves — the ticket's boundary, and the reason this returns a path rather
 * than a mode some page then has to render differently.
 *
 * Falls back to the shop home whenever the departure a story wants is not
 * there. A seeded shop always has upcoming trips, so this is unreachable in
 * practice; it exists because the alternative to a fallback is a demo door that
 * 404s a prospect, and a demo that dead-ends is worse than one that opens a
 * step to the left of where it meant to.
 */
export async function demoStoryPath(
  db: AppDb,
  shopId: string,
  slug: string,
  story: DemoStoryId,
): Promise<string> {
  const home = `/shop/${slug}`;
  if (story === "first-booking") return publicSchedulePath(slug);

  const upcoming = await upcomingTripsWithCounts(db, shopId);
  if (upcoming.length === 0) return home;

  if (story === "returning-diver") {
    // The prep list is only a story when somebody is on the boat — an empty
    // one shows the shop knowing nothing about nobody.
    const crewed = upcoming.find((trip) => trip.booked > 0) ?? upcoming[0];
    return crewed ? `${home}/trips/${crewed.id}/prep` : home;
  }

  // The weather day opens on the confirm page with the departure **still
  // running**, so the visitor calls it off themselves and watches the cascade
  // they caused. Pre-cancelling would seed a trouble state into a demo, which
  // AGENTS.md refuses, and would take away the only part of the story that
  // shows the crew handling anything.
  //
  // The fullest boat, because a blow-out with one diver aboard understates
  // what the cascade does.
  const busiest = [...upcoming].sort((a, b) => b.booked - a.booked)[0];
  return busiest && busiest.booked > 0
    ? `${home}/schedule/blowout/${busiest.id}`
    : `${home}/schedule/board`;
}
