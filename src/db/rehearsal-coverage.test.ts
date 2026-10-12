import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { loadShopExportBundleInput, loadShopExportCounts } from "./export";
import { clearFinishedRehearsals, notificationHeldForRehearsal } from "./rehearsals";
import { getMonthlyReport } from "./reporting";
import { bookings, people, personRoles, trips } from "./schema";
import { createTrip, pagedUpcomingTripsWithCounts, updateTrip } from "./trips";
import { tripExistsForShop } from "./trips-record";

/**
 * **Every place that must honour a rehearsal, walked** (ADR
 * 20261012-rehearsal-departures). A rehearsal never sends a message, never
 * appears in public, never counts in reports, exports, availability or
 * integrations, and never charges money. This file is the ADR's list, kept
 * true in four ways:
 *
 * 1. **Outward reads.** Every read of `trips` in a module whose answer leaves
 *    the shop's staff screens — the reports, the public site's reads, the
 *    staff calendar feed — carries `notRehearsal()`, or says why not with
 *    `diveday:allow-rehearsal: <why>` inside the query.
 * 2. **Gates.** Each chokepoint still holds the line that makes it one.
 * 3. **Senders.** Every file that can hand a message to a provider is named
 *    here with the reason a rehearsal's message never leaves through it. A new
 *    sender fails this file until someone says which.
 * 4. **Behaviour.** A real rehearsal with a real seat, read back through the
 *    doors that matter.
 */

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** Modules whose answers leave the staff screens. */
const OUTWARD_MODULES = [
  // Reports and the numbers DiveDay itself reads.
  "src/db/reporting.ts",
  "src/db/report-lines.ts",
  "src/db/founder-metrics.ts",
  "src/db/weekly-digest.ts",
  "src/db/season-scale.ts",
  // The public site.
  "src/db/dive-sites.ts",
  "src/db/trip-sightings.ts",
  "src/db/month-sightings.ts",
  // The staff calendar feed, which leaves for someone's phone calendar.
  "src/features/calendar-sync/feed-trips.ts",
] as const;

const ANCHOR = /\.from\(trips\)|\.(?:inner|left)Join\(\s*trips\b/;
const ALLOW = "diveday:allow-rehearsal:";

/**
 * Named predicates that carry the filter for a whole function's reads, so each
 * query need not repeat it: the month report's `inWindow`. Every definition of
 * one in the file must itself contain `notRehearsal()`.
 */
const CARRIERS: Record<string, readonly string[]> = {
  "src/db/reporting.ts": ["inWindow"],
};

/** Definitions of `name` in `source` (`const name = and(` … `);`) that leave rehearsals in. */
function carriersWithoutFilter(source: string, name: string): number[] {
  const lines = source.split("\n");
  return lines.flatMap((line, index) => {
    if (!line.includes(`const ${name} = and(`)) return [];
    const end = lines.findIndex((next, at) => at > index && /^\s*\);/.test(next));
    return lines
      .slice(index, end + 1)
      .join("\n")
      .includes("notRehearsal()")
      ? []
      : [index + 1];
  });
}

/** Reads of `trips` in `source` that carry neither the filter nor a reason. */
function unguardedRehearsalReads(source: string, carriers: readonly string[] = []): number[] {
  const lines = source.split("\n");
  const anchors = lines.flatMap((line, index) => (ANCHOR.test(line) ? [index] : []));
  return anchors.flatMap((index, position) => {
    // From a few lines above (a reason written over the join) to the next
    // anchor, so one query is never covered by its neighbour's filter.
    const end = Math.min(index + 60, anchors[position + 1] ?? lines.length);
    const window = lines.slice(Math.max(0, index - 3), end).join("\n");
    const carried = carriers.some((name) => new RegExp(`\\b${name}\\b`).test(window));
    return window.includes("notRehearsal()") || window.includes(ALLOW) || carried
      ? []
      : [index + 1];
  });
}

/** Chokepoints, and the line in each that makes it one. */
const GATES: { file: string; holds: string; times?: number; why: string }[] = [
  {
    file: "src/db/schema/trips.ts",
    holds: "trips_rehearsal_is_private",
    why: "a rehearsal is private by constraint, so every public listing that hides private departures hides it",
  },
  {
    file: "src/db/trips-create.ts",
    holds: "input.isRehearsal",
    why: "created private, unpriced and outside any series",
  },
  {
    file: "src/db/trips-record.ts",
    holds: "unlessRehearsal(",
    why: "an edit can never price a rehearsal or make it public",
  },
  {
    file: "src/db/trips-record.ts",
    holds: "liveTrip(), notRehearsal()",
    why: "`tripExistsForShop`: the edge refuses a rehearsal's public URL",
  },
  {
    file: "src/app/s/[shopSlug]/trips/[id]/page.tsx",
    holds: "trip.isRehearsal",
    times: 2,
    why: "the public trip page and its metadata answer not-found",
  },
  {
    file: "src/app/s/[shopSlug]/trips/[id]/opengraph-image.tsx",
    holds: "trip.isRehearsal",
    why: "no link-preview card names it",
  },
  {
    file: "src/db/bookings.ts",
    holds: 'actor === "staff" || !trip.isRehearsal',
    why: "only staff seat anyone on a rehearsal",
  },
  {
    file: "src/db/waitlist.ts",
    holds: "notRehearsal()",
    why: "no wait list",
  },
  {
    file: "src/db/checkouts.ts",
    holds: "tripRow.trip.isRehearsal",
    why: "no card checkout",
  },
  {
    file: "src/db/orders.ts",
    holds: "notRehearsal()",
    why: "no invoice",
  },
  {
    file: "src/db/integration-events.ts",
    holds: "isRehearsal",
    why: "no order reaches Shopify, QuickBooks, Xero or Zapier",
  },
  {
    file: "src/db/trip-promos.ts",
    holds: "tripRow.isRehearsal",
    why: "no last-minute deal",
  },
  {
    file: "src/db/notifications.ts",
    holds: "notificationHeldForRehearsal(",
    times: 3,
    why: "every email — the single send, the batch, the retry drain — is held",
  },
  {
    file: "src/db/waiver-issue.ts",
    holds: 'trip.isRehearsal ? "link"',
    times: 2,
    why: "a release or course-forms link is issued for hand-over, never texted or emailed",
  },
  {
    file: "src/db/reminders.ts",
    holds: "notRehearsal()",
    why: "no reminder, by email or text",
  },
  {
    file: "src/db/recap.ts",
    holds: "notRehearsal()",
    why: "no recap, by email or text",
  },
  {
    file: "src/db/crew-notices.ts",
    holds: "eq(trips.isRehearsal, true)",
    why: "crew news about a rehearsal is never written down to be told",
  },
  {
    file: "src/db/push-subscriptions.ts",
    holds: "notRehearsal()",
    times: 2,
    why: "no push subscription and no push",
  },
  {
    file: "src/db/export.ts",
    holds: "withoutRehearsals(",
    times: 2,
    why: "the shop's bundle and a diver's bundle leave it out",
  },
  {
    file: "src/db/export.ts",
    holds: "shopRehearsalIds(db, shopId)",
    why: "the settings page's counts agree with the bundle",
  },
  {
    file: "src/app/api/cron/trip-series/route.ts",
    holds: "clearFinishedRehearsals(db)",
    why: "deleted the night after it comes home",
  },
];

/**
 * Every file that hands a message to a provider, and why a rehearsal's
 * message never leaves through it.
 */
const HELD_AT_CHOKEPOINT =
  "email through `sendNotification`, held by `notificationHeldForRehearsal`";
const NOT_ABOUT_A_DEPARTURE = "never about a departure";
const SENDERS: Record<string, string> = {
  "src/lib/notifications/courtesy.ts": "the SMS/WhatsApp primitive; its callers are listed here",
  "src/lib/notifications/web-push.ts": "the push primitive; its one caller is push-subscriptions",
  "src/db/notifications.ts": "the chokepoint itself",
  "src/db/push-subscriptions.ts": "reads the departure with `notRehearsal()` before any push",
  "src/db/manifest-events.ts": "calls `pushManifestChanged`, which reads with `notRehearsal()`",
  "src/db/reminders.ts": "the candidate scan carries `notRehearsal()`, so no email or text",
  "src/db/recap.ts": "the candidate scan carries `notRehearsal()`, so no email or text",
  "src/db/waiver-issue.ts": "a rehearsal's link is hand-over only, never texted or emailed",
  "src/db/crew-notices.ts": "a rehearsal's crew news is never recorded",
  "src/db/trip-promos.ts": "a last-minute deal is refused for a rehearsal",
  "src/db/blowouts.ts": HELD_AT_CHOKEPOINT,
  "src/db/booking-cancelled-notice.ts": HELD_AT_CHOKEPOINT,
  "src/db/booking-handoff.ts": HELD_AT_CHOKEPOINT,
  "src/db/checkout-recovery.ts": HELD_AT_CHOKEPOINT,
  "src/db/find-my-booking.ts": HELD_AT_CHOKEPOINT,
  "src/db/readiness-link-rescue.ts": HELD_AT_CHOKEPOINT,
  "src/db/trip-invitations.ts": HELD_AT_CHOKEPOINT,
  "src/db/waitlist.ts": HELD_AT_CHOKEPOINT,
  "src/db/waiver-guardian-copy.ts": HELD_AT_CHOKEPOINT,
  "src/app/s/[shopSlug]/trips/[id]/actions.ts":
    "the public trip page, which a rehearsal never reaches",
  "src/app/shop/[shopSlug]/trips/[id]/actions.ts": HELD_AT_CHOKEPOINT,
  "src/db/desk-pings.ts": NOT_ABOUT_A_DEPARTURE,
  "src/db/staff-reply.ts": NOT_ABOUT_A_DEPARTURE,
  "src/db/weekly-digest.ts": "its counts carry `notRehearsal()`",
  "src/db/work-order-follow-up.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/actions/demo-instrumentation.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/actions/inquiry.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/forgot-password/actions.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/onboard/actions.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/reset-password/[token]/actions.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/shop/[shopSlug]/settings/shop-actions.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/shop/[shopSlug]/settings/team/actions.ts": NOT_ABOUT_A_DEPARTURE,
};

const SENDER_CALL =
  /\b(?:sendNotification|sendNotificationBatch|sendAndRecordNotification|sendCourtesyMessage|sendWebPush|pushManifestChanged)\(/;

function sourceFiles(directory: string): string[] {
  return readdirSync(path.join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [relative] : [];
  });
}

describe("rehearsal coverage: the static walk", () => {
  it("finds a read that forgets the filter", () => {
    const forgot = ["db", "  .select()", "  .from(trips)", "  .where(liveTrip());"].join("\n");
    expect(unguardedRehearsalReads(forgot)).toEqual([3]);
    const remembered = forgot.replace("liveTrip()", "and(liveTrip(), notRehearsal())");
    expect(unguardedRehearsalReads(remembered)).toEqual([]);
  });

  it.each(OUTWARD_MODULES)("%s: every read of trips leaves rehearsals out", (file) => {
    const carriers = CARRIERS[file] ?? [];
    expect(unguardedRehearsalReads(read(file), carriers)).toEqual([]);
    for (const name of carriers) expect(carriersWithoutFilter(read(file), name)).toEqual([]);
  });

  it.each(GATES)("$file holds: $why", ({ file, holds, times = 1 }) => {
    expect(read(file).split(holds).length - 1).toBeGreaterThanOrEqual(times);
  });

  it("knows why every sender keeps a rehearsal's message in", () => {
    const senders = ["src/db", "src/app", "src/lib", "src/features"]
      .flatMap(sourceFiles)
      .filter((file) => SENDER_CALL.test(read(file)));
    const unclassified = senders.filter((file) => !(file in SENDERS));
    expect(unclassified, "classify each new sender in SENDERS, with its reason").toEqual([]);
  });
});

const ctx = fileScopedShopContext();
const NOW = new Date("2031-05-10T12:00:00Z");

async function rehearsalWithASeat() {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const startsAt = new Date(NOW.getTime() + 48 * HOUR_MS);
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Training day drill",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 6,
    priceCents: 12_000,
    isRehearsal: true,
  });
  if (!trip || !owner) throw new Error("fixture failed");
  const party = await createBookingParty(db, [
    {
      actor: "staff" as const,
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Test Diver",
      email: "test-diver@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`seat refused: ${party.reason}`);
  return { db, shop, trip, ownerId: owner.id, bookingId: party.bookings[0].bookingId };
}

describe("rehearsal coverage: a real rehearsal", () => {
  it("is created private and unpriced, and an edit cannot change either", async () => {
    const { db, shop, trip } = await rehearsalWithASeat();
    expect(trip).toMatchObject({ isRehearsal: true, isPrivate: true, priceCents: null });
    const edited = await updateTrip(db, shop.id, trip.id, {
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      capacity: trip.capacity,
      plannedDives: trip.plannedDives,
      isPrivate: false,
      priceCents: 9_000,
    });
    expect(edited.ok && edited.trip).toMatchObject({ isPrivate: true, priceCents: null });
  });

  it("refuses to exist in public at the database", async () => {
    const { db, trip } = await rehearsalWithASeat();
    await expect(
      db.update(trips).set({ isPrivate: false }).where(eq(trips.id, trip.id)),
    ).rejects.toThrow();
  });

  it("is on no public list, has no public URL, and takes no public booking", async () => {
    const { db, shop, trip } = await rehearsalWithASeat();
    const listed = await pagedUpcomingTripsWithCounts(db, shop.id, {
      now: NOW,
      publicOnly: true,
      limit: 200,
    });
    expect(listed.trips.map((row) => row.id)).not.toContain(trip.id);
    expect(await tripExistsForShop(db, shop.id, trip.id)).toBe(false);
    const publicSeat = await createBookingParty(db, [
      {
        actor: "public" as const,
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Walk Up",
        email: "walk-up@example.com",
      },
    ]);
    expect(publicSeat).toMatchObject({ ok: false, reason: "trip_unavailable" });
  });

  it("holds every message about it, whichever handle the message carries", async () => {
    const { db, shop, trip, bookingId } = await rehearsalWithASeat();
    const about = (handle: Record<string, string>) =>
      ({ kind: "trip_conditions_hold", shopId: shop.id, ...handle }) as never;
    expect(await notificationHeldForRehearsal(db, about({ tripId: trip.id }))).toBe(true);
    expect(await notificationHeldForRehearsal(db, about({ bookingId }))).toBe(true);
    // Another shop's id for the same row reaches nothing.
    expect(
      await notificationHeldForRehearsal(db, {
        kind: "trip_conditions_hold",
        shopId: "00000000-0000-0000-0000-000000000000",
        tripId: trip.id,
      } as never),
    ).toBe(false);
  });

  it("is in neither the export nor its counts", async () => {
    const { db, shop, trip, bookingId } = await rehearsalWithASeat();
    const bundle = await loadShopExportBundleInput(db, shop.id);
    const counts = await loadShopExportCounts(db, shop.id);
    if (!bundle || !counts) throw new Error("export failed");
    const cells = bundle.tables.flatMap((table) => table.rows.flat());
    expect(cells).not.toContain(trip.id);
    expect(cells).not.toContain(bookingId);
    for (const [index, row] of counts.entries()) {
      expect(row.count).toBe(bundle.tables[index].rows.length);
    }
  });

  it("is not counted in the month's report", async () => {
    const { db, shop, trip } = await rehearsalWithASeat();
    const report = await getMonthlyReport(
      db,
      shop.id,
      new Date(trip.startsAt.getTime() - 24 * HOUR_MS),
      new Date(trip.endsAt.getTime() + 24 * HOUR_MS),
    );
    expect(report.trips.map((row) => row.tripId)).not.toContain(trip.id);
  });

  it("is deleted, seats and all, once it has come home — and nothing else is", async () => {
    const { db, shop, trip, bookingId } = await rehearsalWithASeat();
    const deletedOthers = async () =>
      (
        await db
          .select({ deletedAt: trips.deletedAt })
          .from(trips)
          .where(and(eq(trips.shopId, shop.id), eq(trips.isRehearsal, false)))
      ).filter((row) => row.deletedAt !== null).length;
    const before = await deletedOthers();
    expect(await clearFinishedRehearsals(db, new Date(trip.endsAt.getTime() - 1))).toBe(0);
    expect(await clearFinishedRehearsals(db, trip.endsAt)).toBe(1);
    const [cleared] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(cleared?.deletedAt).not.toBeNull();
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(seat?.status).toBe("cancelled");
    expect(await deletedOthers()).toBe(before);
  });
});
