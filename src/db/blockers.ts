import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { pointingLabelText } from "@/i18n/today-labels";
import { annotateAlsoOn, type BlockerQueueTrip, blockerFixFor } from "@/lib/blockers";
import { nowDate } from "@/lib/clock";
import { OPERATIONAL_MAX_TRIPS, operationalWindow } from "@/lib/operational-window";
import type { AppDb } from "./client";
import { listTripsReadiness } from "./readiness";
import { pagedUpcomingTripsWithCounts } from "./trips";

/**
 * Not ready is a lens on the same queue Today ranks, not a fourth product with
 * its own idea of "upcoming". Both read the shared operational horizon
 * (`src/lib/operational-window.ts`); this file used to cap itself at the
 * nearest 40 departures instead, which is why the nav badge, the Today counts,
 * and this page could each report a different number of blocked divers.
 *
 * `OPERATIONAL_MAX_TRIPS` is a work bound, not the window: departures are
 * filtered to the horizon *before* readiness is computed, and the cap only
 * fires for a shop with more departures inside one week than any triage list
 * should carry. When it does fire the queue says so (`truncated`) rather than
 * dropping the tail in silence.
 */

/** Every in-horizon departure plus its readiness rows, in one place. */
async function inHorizonReadiness(db: AppDb, shopId: string, now: Date) {
  const { to: horizon } = operationalWindow(now);
  const { trips: fetched, nextCursor } = await pagedUpcomingTripsWithCounts(db, shopId, {
    now,
    limit: OPERATIONAL_MAX_TRIPS,
  });
  const inWindow = fetched.filter((trip) => trip.startsAt <= horizon);
  // The cap only truncated anything if more departures exist past what it
  // fetched *and* every one it did fetch was still inside the horizon — if the
  // horizon ended the list first, nothing inside the window is missing.
  const truncated = nextCursor !== null && inWindow.length === fetched.length;

  // One batched readiness pass for the whole window — the same call the Today
  // queue makes, so the two surfaces can never disagree about who is blocked.
  const readinessByTrip = new Map<string, Awaited<ReturnType<typeof listTripsReadiness>>>();
  for (const trip of inWindow) readinessByTrip.set(trip.id, []);
  for (const row of await listTripsReadiness(
    db,
    shopId,
    inWindow.map((trip) => trip.id),
    now,
  )) {
    readinessByTrip.get(row.booking.tripId)?.push(row);
  }
  return { trips: inWindow, readinessByTrip, truncated };
}

export type BlockerQueue = {
  trips: BlockerQueueTrip[];
  /**
   * True only when the shop has more departures inside the shared horizon than
   * the work bound inspects — never for departures beyond the horizon, which
   * the window note already discloses on every readiness surface.
   */
  truncated: boolean;
};

/**
 * Every diver who can't board yet, grouped by the departure that holds them up,
 * across the shared operational horizon. Trips with no blocked diver are
 * omitted — the queue is a list of problems, not a schedule.
 */
export async function getBlockerQueue(
  db: AppDb,
  shopId: string,
  shopSlug: string,
  now: Date = nowDate(),
  /**
   * Resolves every fix's button label (`blockerFixFor`, `src/lib/blockers.ts`).
   * Defaults to English so every pre-existing caller (tests included) keeps
   * working unchanged; the page passes its own request-locale translator.
   */
  t: StaffTranslator = staffTranslator("en-US"),
): Promise<BlockerQueue> {
  const {
    trips: inspected,
    readinessByTrip,
    truncated,
  } = await inHorizonReadiness(db, shopId, now);

  const trips: BlockerQueueTrip[] = [];
  for (const trip of inspected) {
    const rows = readinessByTrip.get(trip.id) ?? [];
    const divers = rows
      .filter((row) => row.readiness.status === "blocked")
      .map((row) => ({
        bookingId: row.booking.id,
        personId: row.person.id,
        fullName: row.person.fullName,
        blockers: [...row.readiness.blockers],
        // Every blocked row has at least one blocker, so a fix always resolves.
        fix: blockerFixFor(
          row.readiness.blockers,
          {
            shopSlug,
            tripId: trip.id,
            personId: row.person.id,
            bookingId: row.booking.id,
            fullName: row.person.fullName,
          },
          t,
        ) ?? {
          // Every blocked row has at least one blocker (`primaryBlocker` never
          // returns null here), so this fallback is unreachable in practice —
          // kept only because `blockerFixFor` types as nullable. Same "points
          // at the roster" wording as any other row with nowhere more specific
          // to send a diver.
          label: pointingLabelText(t, "trip", row.person.fullName),
          href: `/shop/${shopSlug}/trips/${trip.id}/guests`,
          sendsWaiver: false,
          bookingId: row.booking.id,
        },
        // Filled once the whole queue is built (a repeat diver spans trips).
        alsoOn: [],
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    if (divers.length === 0) continue;
    trips.push({
      tripId: trip.id,
      title: trip.title,
      startsAt: trip.startsAt,
      courseTitle: trip.course?.title ?? null,
      booked: trip.booked,
      ready: rows.filter((row) => row.readiness.status === "ready").length,
      divers,
    });
  }

  annotateAlsoOn(trips);
  return { trips, truncated };
}

/**
 * Distinct divers who can't board yet, across the same shared horizon
 * `getBlockerQueue` inspects — for the nav badge (task 83, UX persona 11
 * "Kai"/12 "Maren"), which only needs the headline count, not each row's fix
 * label/href. It walks the *same* helper as the full queue, so the badge and
 * the page it links to can never report different numbers; there is no cheaper
 * SQL-only signal, since "blocked" is a business rule computed from
 * certs/waivers/payment rather than a stored flag.
 */
export async function countBlockedDivers(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<number> {
  const { trips, readinessByTrip } = await inHorizonReadiness(db, shopId, now);
  const blocked = new Set<string>();
  for (const trip of trips) {
    for (const row of readinessByTrip.get(trip.id) ?? []) {
      if (row.readiness.status === "blocked") blocked.add(row.person.id);
    }
  }
  return blocked.size;
}
